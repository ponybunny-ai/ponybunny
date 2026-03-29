import { NextResponse } from 'next/server';
import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:18789';

interface ResponseFrame {
  type: 'res';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

async function callGatewayRPC<T>(method: string, params: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    const requestId = crypto.randomUUID();
    let timeout: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      ws.close();
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Request timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'req', id: requestId, method, params }));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString()) as ResponseFrame;
        if (frame.type === 'res' && frame.id === requestId) {
          cleanup();
          if (frame.error) reject(new Error(frame.error.message));
          else resolve(frame.result as T);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    ws.on('error', (error) => { cleanup(); reject(error); });
    ws.on('close', () => { cleanup(); reject(new Error('Connection closed')); });
  });
}

export interface ErrorCluster {
  error_signature: string;
  count: number;
  most_recent: number;
  affected_goals: number;
}

export interface ItemTypeFailureRate {
  item_type: string;
  total_runs: number;
  failed_runs: number;
  failure_rate: number;
}

export interface GoalTimelineEntry {
  date: string;
  completed: number;
  failed: number;
}

export interface EvaluationDistribution {
  total_reports: number;
  total_publish: number;
  total_retry: number;
  total_replan: number;
  total_escalate: number;
  total_skipped: number;
}

export interface KnowledgeStats {
  total_entries: number;
  by_type: Record<string, number>;
  avg_confidence: number;
  recently_reinforced: number;
}

export interface DashboardData {
  scheduler: {
    totalGoalsProcessed: number;
    totalWorkItemsCompleted: number;
    totalRunsExecuted: number;
    averageWorkItemDurationMs: number;
    successRate: number;
    currentActiveGoals: number;
    currentActiveWorkItems: number;
  } | null;
  audit: {
    total: number;
    by_action: Record<string, number>;
    by_entity_type: Record<string, number>;
  } | null;
  errorClusters: ErrorCluster[] | null;
  failureRates: ItemTypeFailureRate[] | null;
  timeline: GoalTimelineEntry[] | null;
  evaluationDistribution: EvaluationDistribution | null;
  knowledgeStats: KnowledgeStats | null;
}

export async function GET() {
  try {
    const [
      schedulerResult,
      auditResult,
      errorClustersResult,
      failureRatesResult,
      timelineResult,
      evalDistResult,
      knowledgeStatsResult,
    ] = await Promise.allSettled([
      callGatewayRPC<{ metrics: DashboardData['scheduler'] }>('debug.scheduler', {}),
      callGatewayRPC<DashboardData['audit']>('audit.stats', {}),
      callGatewayRPC<{ clusters: ErrorCluster[] }>('harness.errorClusters', {}),
      callGatewayRPC<{ rates: ItemTypeFailureRate[] }>('harness.failureRates', {}),
      callGatewayRPC<{ timeline: GoalTimelineEntry[] }>('harness.timeline', { days: 30 }),
      callGatewayRPC<{ distribution: EvaluationDistribution }>('harness.evaluationDistribution', {}),
      callGatewayRPC<{ stats: KnowledgeStats }>('harness.knowledgeStats', {}),
    ]);

    const data: DashboardData = {
      scheduler: schedulerResult.status === 'fulfilled' ? schedulerResult.value.metrics : null,
      audit: auditResult.status === 'fulfilled' ? auditResult.value : null,
      errorClusters: errorClustersResult.status === 'fulfilled' ? errorClustersResult.value.clusters : null,
      failureRates: failureRatesResult.status === 'fulfilled' ? failureRatesResult.value.rates : null,
      timeline: timelineResult.status === 'fulfilled' ? timelineResult.value.timeline : null,
      evaluationDistribution: evalDistResult.status === 'fulfilled' ? evalDistResult.value.distribution : null,
      knowledgeStats: knowledgeStatsResult.status === 'fulfilled' ? knowledgeStatsResult.value.stats : null,
    };

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch dashboard data',
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure the Gateway server is running on ' + GATEWAY_URL,
      },
      { status: 500 }
    );
  }
}
