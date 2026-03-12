import { ensureAgentWorkdir } from './agent-workdir.js';
import type { AgentConfigSource } from './agent-discovery.js';
import {
  getGlobalAgentRegistry,
  type AgentDefinition,
  type AgentDefinitionStatus,
  type AgentRegistry,
} from './agent-registry.js';
import {
  ProcessSubagentManager,
  type StartedSubagentProcess,
  type SubagentHeartbeatSnapshot,
  type SubagentProcessManager,
  type SubagentProcessTarget,
} from './subagent-process-manager.js';

export interface SubagentExecutionCapability {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  source: AgentConfigSource;
  status: AgentDefinitionStatus;
  scheduleKind: 'cron' | 'interval';
  configPath: string;
  configuredWorkdir?: string;
}

export interface SubagentExecutionPlanInput {
  agentId: string;
  runKey: string;
  goalId?: string;
  isSubagent: boolean;
  subAgents: string[];
}

export interface SubagentExecutionRuntimeContext {
  subagentProcesses: Array<{
    subagentId: string;
    pid: number;
  }>;
  subagentHeartbeats: SubagentHeartbeatSnapshot[];
}

export interface SubagentExecutionScope {
  getRuntimeContext(): SubagentExecutionRuntimeContext;
  stop(): Promise<void>;
}

export interface SubagentExecutionBoundary {
  listAgentCapabilities(options?: { ensureLoaded?: boolean }): Promise<SubagentExecutionCapability[]>;
  startExecution(plan: SubagentExecutionPlanInput): Promise<SubagentExecutionScope>;
}

type SubagentCapabilityRegistry = Pick<AgentRegistry, 'getAgent' | 'getAgents'> & {
  loadAgents?: (options: { workspaceDir: string }) => Promise<void>;
};

const EMPTY_RUNTIME_CONTEXT: SubagentExecutionRuntimeContext = {
  subagentProcesses: [],
  subagentHeartbeats: [],
};

const toCapability = (definition: AgentDefinition): SubagentExecutionCapability => ({
  id: definition.id,
  name: definition.config.name,
  type: definition.config.type,
  enabled: definition.config.enabled,
  source: definition.source,
  status: definition.status,
  scheduleKind: definition.config.schedule.kind,
  configPath: definition.configPath,
  configuredWorkdir: definition.config.workdir,
});

class InactiveSubagentExecutionScope implements SubagentExecutionScope {
  getRuntimeContext(): SubagentExecutionRuntimeContext {
    return EMPTY_RUNTIME_CONTEXT;
  }

  async stop(): Promise<void> {}
}

class ActiveSubagentExecutionScope implements SubagentExecutionScope {
  constructor(
    private readonly processManager: SubagentProcessManager,
    private readonly startedSubagents: StartedSubagentProcess[]
  ) {}

  getRuntimeContext(): SubagentExecutionRuntimeContext {
    return {
      subagentProcesses: this.startedSubagents.map((processInfo) => ({
        subagentId: processInfo.subagentId,
        pid: processInfo.pid,
      })),
      subagentHeartbeats: this.processManager.getHeartbeatSnapshot(this.startedSubagents),
    };
  }

  async stop(): Promise<void> {
    await this.processManager.stopSubagents(this.startedSubagents);
  }
}

export class RegistryBackedSubagentExecutionBoundary implements SubagentExecutionBoundary {
  constructor(
    private readonly registry: SubagentCapabilityRegistry = getGlobalAgentRegistry(),
    private readonly processManager: SubagentProcessManager = new ProcessSubagentManager(),
    private readonly logger: Pick<Console, 'warn'> = console,
    private readonly workspaceDirProvider: () => string = () => process.cwd()
  ) {}

  async listAgentCapabilities(
    options: { ensureLoaded?: boolean } = {}
  ): Promise<SubagentExecutionCapability[]> {
    if (
      options.ensureLoaded === true
      && this.registry.getAgents().length === 0
      && this.registry.loadAgents
    ) {
      await this.registry.loadAgents({ workspaceDir: this.workspaceDirProvider() });
    }

    return this.registry.getAgents().map(toCapability);
  }

  async startExecution(plan: SubagentExecutionPlanInput): Promise<SubagentExecutionScope> {
    const targets = this.resolveSpawnTargets(plan);
    if (targets.length === 0) {
      return new InactiveSubagentExecutionScope();
    }

    const startedSubagents = await this.processManager.startSubagents({
      agentId: plan.agentId,
      runKey: plan.runKey,
      goalId: plan.goalId,
      targets,
    });

    if (startedSubagents.length === 0) {
      return new InactiveSubagentExecutionScope();
    }

    return new ActiveSubagentExecutionScope(this.processManager, startedSubagents);
  }

  private resolveSpawnTargets(plan: SubagentExecutionPlanInput): SubagentProcessTarget[] {
    if (plan.isSubagent || plan.subAgents.length === 0) {
      return [];
    }

    const targets: SubagentProcessTarget[] = [];

    for (const subagentId of plan.subAgents) {
      const definition = this.registry.getAgent(subagentId);
      if (!definition || !definition.config.enabled) {
        this.logger.warn('[SubagentProcessManager] Subagent definition missing or disabled', {
          subagentId,
          parentAgentId: plan.agentId,
        });
        continue;
      }

      targets.push({
        subagentId,
        workdir: ensureAgentWorkdir({
          agentId: subagentId,
          configuredWorkdir: definition.config.workdir,
          configPath: definition.configPath,
        }),
      });
    }

    return targets;
  }
}

let globalSubagentExecutionBoundary: SubagentExecutionBoundary | null = null;

export function getGlobalSubagentExecutionBoundary(): SubagentExecutionBoundary {
  if (!globalSubagentExecutionBoundary) {
    globalSubagentExecutionBoundary = new RegistryBackedSubagentExecutionBoundary();
  }

  return globalSubagentExecutionBoundary;
}
