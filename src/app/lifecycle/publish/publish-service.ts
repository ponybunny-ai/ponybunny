import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IPublishService, PublishResult } from '../stage-interfaces.js';

export class PublishService implements IPublishService {
  constructor(private repository: IWorkOrderRepository) {}

  async publishWorkItem(workItem: WorkItem, run: Run): Promise<PublishResult> {
    const allRuns = this.repository.getRunsByWorkItem(workItem.id);
    
    const totalTokens = allRuns.reduce((sum, r) => sum + r.tokens_used, 0);
    const totalTime = allRuns.reduce((sum, r) => sum + (r.time_seconds || 0), 0);
    const totalCost = allRuns.reduce((sum, r) => sum + r.cost_usd, 0);

    const artifacts = run.artifacts;

    const summary = this.buildSummary(workItem, run, allRuns);

    return {
      artifacts,
      summary,
      costSummary: {
        tokens: totalTokens,
        time_minutes: Math.ceil(totalTime / 60),
        cost_usd: totalCost,
      },
    };
  }

  private buildSummary(workItem: WorkItem, finalRun: Run, allRuns: Run[]): string {
    const lines: string[] = [];
    
    lines.push(`Work Item: ${workItem.title}`);
    lines.push(`Status: ${workItem.status}`);
    lines.push(`Total Runs: ${allRuns.length}`);
    lines.push(`Retry Count: ${workItem.retry_count}/${workItem.max_retries}`);
    
    if (finalRun.status === 'success') {
      lines.push(`Final Run: SUCCESS`);
    } else {
      lines.push(`Final Run: ${finalRun.status}`);
    }

    return lines.join('\n');
  }
}
