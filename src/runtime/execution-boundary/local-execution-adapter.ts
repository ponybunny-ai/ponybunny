import { getAgentTickContext } from '../../infra/agents/agent-tick-context.js';
import { getGlobalAgentRegistry } from '../../infra/agents/agent-registry.js';
import { getGlobalRunnerRegistry } from '../../infra/agents/runner-registry.js';
import type { WorkItem } from '../../work-order/types/index.js';
import type { ExecutionRunner } from './execution-runner.js';
import type { ExecutionPort, ExecutionRequest, ExecutionResult } from './types.js';

interface ActiveExecution {
  runId: string;
  workItemId: string;
  abortController: AbortController;
  startedAt: number;
}

export class LocalExecutionAdapter implements ExecutionPort {
  private activeExecutions: Map<string, ActiveExecution> = new Map();

  constructor(private executionRunner: ExecutionRunner) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const { workItem } = request;
    const agentTick = getAgentTickContext(workItem);
    if (agentTick) {
      return this.executeAgentTick(request, agentTick);
    }

    return this.executeWithExecutionService(request);
  }

  async abort(runId: string): Promise<void> {
    const execution = this.activeExecutions.get(runId);
    if (!execution) {
      console.warn(`[LocalExecutionAdapter] No active execution found for runId: ${runId}`);
      return;
    }

    execution.abortController.abort();
    this.activeExecutions.delete(runId);
  }

  getActiveCount(): number {
    return this.activeExecutions.size;
  }

  private async executeAgentTick(
    request: ExecutionRequest,
    agentTick: NonNullable<ReturnType<typeof getAgentTickContext>>
  ): Promise<ExecutionResult> {
    const registry = getGlobalAgentRegistry();
    const definition = registry.getAgent(agentTick.agent_id);
    if (!definition) {
      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent definition not found for '${agentTick.agent_id}'`,
          recoverable: false,
        },
      };
    }

    if (definition.definitionHash !== agentTick.definition_hash) {
      console.warn(
        `[LocalExecutionAdapter] Agent definition hash mismatch for ${agentTick.agent_id}: ` +
        `expected ${definition.definitionHash}, got ${agentTick.definition_hash}`
      );
    }

    const runnerRegistry = getGlobalRunnerRegistry();
    const configuredEngine = definition.config.runner?.engine?.trim();
    const hasTypeRunner = runnerRegistry.hasRunner(definition.config.type);
    const hasExplicitEngineRunner =
      !!configuredEngine && configuredEngine.length > 0 && runnerRegistry.hasRunner(configuredEngine);
    const shouldUseRunnerPath =
      hasTypeRunner ||
      (configuredEngine !== undefined && configuredEngine !== 'default' && hasExplicitEngineRunner);

    if (!shouldUseRunnerPath) {
      return this.executeWithExecutionService(request, {
        routeContext: agentTick.routeContext,
      });
    }

    let runner;
    try {
      runner = runnerRegistry.resolve(definition.id, definition.config);
    } catch (error) {
      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'RUNNER_NOT_FOUND',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      };
    }

    if (!runner) {
      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'RUNNER_NOT_FOUND',
          message: `Runner not available for '${definition.config.type}'`,
          recoverable: false,
        },
      };
    }

    try {
      await runner.runTick({
        agentId: definition.id,
        config: definition.config,
        tick: {
          now: new Date(agentTick.scheduled_for_ms),
          runKey: agentTick.run_key,
          goalId: request.workItem.goal_id,
          workDir: agentTick.agent_workdir,
          routeContext: agentTick.routeContext,
        },
      });

      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: true,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
      };
    } catch (error) {
      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'RUNNER_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      };
    }
  }

  private async executeWithExecutionService(
    request: ExecutionRequest,
    overrides?: { routeContext?: unknown }
  ): Promise<ExecutionResult> {
    const abortController = new AbortController();
    this.activeExecutions.set(request.runId, {
      runId: request.runId,
      workItemId: request.workItem.id,
      abortController,
      startedAt: Date.now(),
    });

    try {
      const executionWorkItem: WorkItem = {
        ...request.workItem,
        context: {
          ...(request.workItem.context ?? {}),
          model: request.workItem.context?.model ?? request.model,
          laneId: request.workItem.context?.laneId ?? request.laneId,
          schedulerRunId: request.runId,
          ...(overrides?.routeContext !== undefined ? { routeContext: overrides.routeContext } : {}),
        },
      };

      // TODO(session10): ExecutionService still persists its own internal run lifecycle.
      // The boundary now exposes only the scheduler-owned runId to callers; later worker
      // extraction should eliminate the internal duplicate run creation entirely.
      const result = await this.executionRunner.executeWorkItem(executionWorkItem);

      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: result.success,
        tokensUsed: result.run.tokens_used ?? 0,
        timeSeconds: result.run.time_seconds ?? 0,
        costUsd: result.run.cost_usd ?? 0,
        artifacts: result.run.artifacts,
        actualModel:
          typeof result.run.context?.actual_model === 'string'
            ? result.run.context.actual_model
            : undefined,
        endpointId:
          typeof result.run.context?.endpoint_id === 'string'
            ? result.run.context.endpoint_id
            : undefined,
        error: result.success
          ? undefined
          : {
              code: result.errorSignature || 'EXECUTION_ERROR',
              message: result.run.error_message || 'Unknown error',
              recoverable: result.needsRetry,
            },
      };
    } catch (error) {
      return {
        runId: request.runId,
        workItemId: request.workItemId,
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'EXECUTION_EXCEPTION',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      };
    } finally {
      this.activeExecutions.delete(request.runId);
    }
  }
}
