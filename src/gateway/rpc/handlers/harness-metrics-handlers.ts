/**
 * Harness Metrics Handlers - RPC handlers for operational metrics aggregation.
 *
 * All methods are read-only and expose HarnessMetricsService aggregations
 * via the Gateway RPC surface.
 */

import type { RpcHandler } from '../rpc-handler.js';
import type {
  HarnessMetricsService,
  ErrorCluster,
  ItemTypeFailureRate,
  GoalTimelineEntry,
  EvaluationDistribution,
  KnowledgeStats,
} from '../../../app/observability/harness-metrics-service.js';

export function registerHarnessMetricsHandlers(
  rpcHandler: RpcHandler,
  metricsService: HarnessMetricsService,
): void {
  // harness.errorClusters - cluster runs by error_signature
  rpcHandler.register<
    { limit?: number },
    { clusters: ErrorCluster[] }
  >(
    'harness.errorClusters',
    ['read'],
    async (params) => {
      const clusters = metricsService.getErrorSignatureClusters(params.limit);
      return { clusters };
    },
  );

  // harness.failureRates - failure rates by work-item type
  rpcHandler.register<
    Record<string, never>,
    { rates: ItemTypeFailureRate[] }
  >(
    'harness.failureRates',
    ['read'],
    async () => {
      const rates = metricsService.getWorkItemTypeFailureRates();
      return { rates };
    },
  );

  // harness.timeline - daily goal success / failure timeline
  rpcHandler.register<
    { days?: number },
    { timeline: GoalTimelineEntry[] }
  >(
    'harness.timeline',
    ['read'],
    async (params) => {
      const timeline = metricsService.getGoalSuccessTimeline(params.days);
      return { timeline };
    },
  );

  // harness.evaluationDistribution - aggregate evaluation decision counts
  rpcHandler.register<
    Record<string, never>,
    { distribution: EvaluationDistribution }
  >(
    'harness.evaluationDistribution',
    ['read'],
    async () => {
      const distribution = metricsService.getEvaluationDecisionDistribution();
      return { distribution };
    },
  );

  // harness.knowledgeStats - global knowledge store effectiveness
  rpcHandler.register<
    Record<string, never>,
    { stats: KnowledgeStats }
  >(
    'harness.knowledgeStats',
    ['read'],
    async () => {
      const stats = metricsService.getKnowledgeEffectiveness();
      return { stats };
    },
  );
}
