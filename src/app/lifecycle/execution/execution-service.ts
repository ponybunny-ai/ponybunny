import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IExecutionService, ExecutionResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { ReActIntegration } from '../../../autonomy/react-integration.js';

export class ExecutionService implements IExecutionService {
  private reactIntegration: ReActIntegration;

  constructor(
    private repository: IWorkOrderRepository,
    private config: {
      maxConsecutiveErrors: number;
    },
    llmProvider?: ILLMProvider
  ) {
    this.reactIntegration = new ReActIntegration(llmProvider);
  }

  async executeWorkItem(workItem: WorkItem): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    const runSequence = this.repository.getRunsByWorkItem(workItem.id).length + 1;
    const run = this.repository.createRun({
      work_item_id: workItem.id,
      goal_id: workItem.goal_id,
      agent_type: workItem.assigned_agent || 'default',
      run_sequence: runSequence,
    });

    try {
      const agentResult = await this.reactIntegration.executeWorkCycle({
        workItem,
        run,
        signal: new AbortController().signal, // TODO: pass from caller
      });

      const timeSeconds = Math.floor((Date.now() - startTime) / 1000);

      this.repository.completeRun(run.id, {
        status: agentResult.success ? 'success' : 'failure',
        error_message: agentResult.error,
        tokens_used: agentResult.tokensUsed,
        time_seconds: timeSeconds,
        cost_usd: agentResult.costUsd,
        artifacts: agentResult.artifactIds || [],
        execution_log: agentResult.log,
      });

      this.repository.updateGoalSpending(
        workItem.goal_id,
        agentResult.tokensUsed,
        Math.ceil(timeSeconds / 60),
        agentResult.costUsd
      );

      const needsRetry = !agentResult.success && !this.shouldEscalateError(workItem);
      const errorSignature = this.generateErrorSignature(agentResult.error);

      return {
        run: this.repository.getRun(run.id)!,
        success: agentResult.success,
        needsRetry,
        errorSignature,
      };
    } catch (error) {
      const timeSeconds = Math.floor((Date.now() - startTime) / 1000);
      
      this.repository.completeRun(run.id, {
        status: 'failure',
        error_message: String(error),
        tokens_used: 0,
        time_seconds: timeSeconds,
        cost_usd: 0,
        artifacts: [],
      });

      return {
        run: this.repository.getRun(run.id)!,
        success: false,
        needsRetry: false,
        errorSignature: this.generateErrorSignature(String(error)),
      };
    }
  }

  private shouldEscalateError(workItem: WorkItem): boolean {
    if (workItem.retry_count >= workItem.max_retries) {
      return true;
    }

    const repeatedErrors = this.repository.getRepeatedErrorSignatures(
      workItem.id,
      this.config.maxConsecutiveErrors
    );
    
    return repeatedErrors.length > 0;
  }

  private generateErrorSignature(error?: string): string | undefined {
    if (!error) return undefined;
    
    const normalized = error
      .replace(/\d+/g, 'N')
      .replace(/0x[0-9a-f]+/gi, 'HEX')
      .replace(/\/[\w\/.-]+/g, 'PATH')
      .substring(0, 200);
    
    return this.simpleHash(normalized);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}
