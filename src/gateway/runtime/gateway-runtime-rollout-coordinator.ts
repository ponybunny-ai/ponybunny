import type { PonyBunnyRuntimeConfig } from '../../infra/config/runtime-config.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { EventBus } from '../events/event-bus.js';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';
import {
  RuntimeRolloutTelemetry,
  type RuntimeDryRunTelemetrySample,
  type RuntimeRolloutMetricsSnapshot,
} from './runtime-rollout-telemetry.js';

const ROLLOUT_THRESHOLD_MIN_CONVERSATION_MESSAGES = 10;
const ROLLOUT_THRESHOLD_MIN_RUNS = 10;
const ROLLOUT_THRESHOLD_MIN_GOALS = 5;
const ROLLOUT_THRESHOLD_CONVERSATION_SUCCESS_RATE = 0.8;
const ROLLOUT_THRESHOLD_RUN_SUCCESS_RATE = 0.75;
const ROLLOUT_THRESHOLD_GOAL_SESSION_COVERAGE = 0.9;

export interface GatewayRuntimeRolloutUpdatePayload {
  deterministicRuntimeEnabled: boolean;
  planCompilerEnabled: boolean;
  toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout: {
    shadowModeEnabled: boolean;
    canaryPercent: number;
    rollbackOnFailure: boolean;
    lanePercents: {
      dryRun: number;
      compile: number;
      replay: number;
    };
  };
}

export interface GatewayRuntimeRolloutConfigStore {
  load(): PonyBunnyRuntimeConfig;
  save(runtime: PonyBunnyRuntimeConfig): void;
}

export interface GatewayRuntimeRolloutSchedulerTransport {
  isConnected(): boolean;
  applyRuntimeRollout(rollout: GatewayRuntimeRolloutUpdatePayload): Promise<void>;
}

export interface GatewayRuntimeRolloutCoordinatorDependencies {
  eventBus: EventBus;
  repository: IWorkOrderRepository;
  configStore: GatewayRuntimeRolloutConfigStore;
  schedulerTransport: GatewayRuntimeRolloutSchedulerTransport;
  logger?: ILogger;
}

export class GatewayRuntimeRolloutCoordinator {
  private readonly eventBus: EventBus;
  private readonly repository: IWorkOrderRepository;
  private readonly configStore: GatewayRuntimeRolloutConfigStore;
  private readonly schedulerTransport: GatewayRuntimeRolloutSchedulerTransport;
  private readonly telemetry = new RuntimeRolloutTelemetry();
  private readonly telemetryUnsubscribers: Array<() => void> = [];
  private readonly logger: ILogger;

  constructor(dependencies: GatewayRuntimeRolloutCoordinatorDependencies) {
    this.eventBus = dependencies.eventBus;
    this.repository = dependencies.repository;
    this.configStore = dependencies.configStore;
    this.schedulerTransport = dependencies.schedulerTransport;
    this.logger = dependencies.logger ?? new NoopLogger();

    this.bindTelemetry();
  }

  dispose(): void {
    for (const unsubscribe of this.telemetryUnsubscribers) {
      unsubscribe();
    }
    this.telemetryUnsubscribers.length = 0;
  }

  getMetricsSnapshot(): RuntimeRolloutMetricsSnapshot {
    return this.telemetry.snapshot();
  }

  collectSessionGoalCoverage(): {
    goalsTotal: number;
    goalsWithSessionLink: number;
    goalSessionCoverageRate: number;
  } {
    const goals = this.repository.listGoals({});
    const goalsTotal = goals.length;
    const goalsWithSessionLink = goals.filter((goal) => {
      const context = goal.context;
      if (!context || typeof context !== 'object') {
        return false;
      }

      const sessionId = (context as Record<string, unknown>).sessionId;
      return typeof sessionId === 'string' && sessionId.trim().length > 0;
    }).length;
    const goalSessionCoverageRate = goalsTotal > 0
      ? goalsWithSessionLink / goalsTotal
      : 0;

    this.telemetry.recordGoalSessionCoverage({
      goalsTotal,
      goalsWithSessionLink,
    });

    return {
      goalsTotal,
      goalsWithSessionLink,
      goalSessionCoverageRate,
    };
  }

  handleDryRunComplete(sample: RuntimeDryRunTelemetrySample): void {
    this.telemetry.recordDryRun(sample);
    if (!sample.ok) {
      void this.rollbackRuntimeRolloutOnFailure();
    }
  }

  async applyRuntimeRolloutUpdate(rollout: GatewayRuntimeRolloutUpdatePayload): Promise<void> {
    if (!this.schedulerTransport.isConnected()) {
      return;
    }

    await this.schedulerTransport.applyRuntimeRollout(rollout);
  }

  private bindTelemetry(): void {
    this.telemetryUnsubscribers.push(
      this.eventBus.on('conversation.new', (sample: unknown) => {
        this.telemetry.recordSessionCreation({
          ok: true,
          timestamp: this.readTimestamp(sample),
        });
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('conversation.new.failed', (sample: unknown) => {
        this.telemetry.recordSessionCreation({
          ok: false,
          timestamp: this.readTimestamp(sample),
        });
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('conversation.message.succeeded', (sample: unknown) => {
        this.telemetry.recordConversationMessage({
          ok: true,
          timestamp: this.readTimestamp(sample),
        });
        void this.evaluateRolloutThresholds();
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('conversation.message.failed', (sample: unknown) => {
        this.telemetry.recordConversationMessage({
          ok: false,
          timestamp: this.readTimestamp(sample),
        });
        void this.evaluateRolloutThresholds();
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('run.started', (sample: unknown) => {
        const payload = this.asRecord(sample);
        const runId = payload?.runId;
        if (typeof runId !== 'string' || runId.length === 0) {
          return;
        }

        this.telemetry.recordRunStarted({
          runId,
          timestamp: this.readTimestamp(sample),
        });
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('run.completed', (sample: unknown) => {
        const payload = this.asRecord(sample);
        this.telemetry.recordRunCompleted({
          runId: typeof payload?.runId === 'string' ? payload.runId : undefined,
          success: typeof payload?.success === 'boolean' ? payload.success : undefined,
          status: typeof payload?.status === 'string' ? payload.status : undefined,
          timestamp: this.readTimestamp(sample),
          timeSeconds: typeof payload?.time_seconds === 'number' ? payload.time_seconds : undefined,
        });
        void this.evaluateRolloutThresholds();
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('goal.created', () => {
        void this.evaluateRolloutThresholds();
      })
    );
    this.telemetryUnsubscribers.push(
      this.eventBus.on('runtime.retention.run', (sample: unknown) => {
        const payload = this.asRecord(sample);
        this.telemetry.recordRetentionRun({
          deleted: typeof payload?.deleted === 'number' ? payload.deleted : 0,
          ok: payload?.ok === true,
          timestamp: this.readTimestamp(sample),
        });
      })
    );
  }

  private async rollbackRuntimeRolloutOnFailure(): Promise<void> {
    const runtime = this.configStore.load();
    if (!runtime.scheduler.runtimeRollout.rollbackOnFailure || this.isLegacyMode(runtime)) {
      return;
    }

    runtime.scheduler.deterministicRuntimeEnabled = false;
    runtime.scheduler.planCompilerEnabled = false;
    runtime.scheduler.toolRoutingMode = 'legacy';
    runtime.scheduler.runtimeRollout.shadowModeEnabled = false;
    runtime.scheduler.runtimeRollout.canaryPercent = 0;
    runtime.scheduler.runtimeRollout.lanePercents = {
      dryRun: 0,
      compile: 0,
      replay: 0,
    };
    this.configStore.save(runtime);

    if (!this.schedulerTransport.isConnected()) {
      return;
    }

    try {
      await this.schedulerTransport.applyRuntimeRollout(this.toRuntimeRolloutUpdatePayload(runtime));
    } catch (error) {
      this.logger.error({ event: 'rollout_rollback_failed' }, 'Failed to apply rollback rollout to scheduler daemon', error instanceof Error ? error : undefined);
    }
  }

  private async evaluateRolloutThresholds(): Promise<void> {
    const runtime = this.configStore.load();
    if (!runtime.scheduler.runtimeRollout.rollbackOnFailure || this.isLegacyMode(runtime)) {
      return;
    }

    this.collectSessionGoalCoverage();
    const sessionFirst = this.telemetry.snapshot().sessionFirst;
    const reasons: string[] = [];

    if (
      sessionFirst.conversationMessagesTotal >= ROLLOUT_THRESHOLD_MIN_CONVERSATION_MESSAGES
      && sessionFirst.conversationMessageSuccessRate < ROLLOUT_THRESHOLD_CONVERSATION_SUCCESS_RATE
    ) {
      reasons.push(
        `conversationMessageSuccessRate=${sessionFirst.conversationMessageSuccessRate.toFixed(3)} < ${ROLLOUT_THRESHOLD_CONVERSATION_SUCCESS_RATE.toFixed(3)}`
      );
    }

    if (
      sessionFirst.runsTotal >= ROLLOUT_THRESHOLD_MIN_RUNS
      && sessionFirst.runSuccessRate < ROLLOUT_THRESHOLD_RUN_SUCCESS_RATE
    ) {
      reasons.push(
        `runSuccessRate=${sessionFirst.runSuccessRate.toFixed(3)} < ${ROLLOUT_THRESHOLD_RUN_SUCCESS_RATE.toFixed(3)}`
      );
    }

    if (
      sessionFirst.goalsTotal >= ROLLOUT_THRESHOLD_MIN_GOALS
      && sessionFirst.goalSessionCoverageRate < ROLLOUT_THRESHOLD_GOAL_SESSION_COVERAGE
    ) {
      reasons.push(
        `goalSessionCoverageRate=${sessionFirst.goalSessionCoverageRate.toFixed(3)} < ${ROLLOUT_THRESHOLD_GOAL_SESSION_COVERAGE.toFixed(3)}`
      );
    }

    if (reasons.length === 0) {
      return;
    }

    this.logger.warn(
      { event: 'rollout_threshold_triggered', reasons },
      `Rollout threshold trigger detected: ${reasons.join('; ')}. Rolling back to legacy mode.`
    );
    await this.rollbackRuntimeRolloutOnFailure();
  }

  private isLegacyMode(runtime: PonyBunnyRuntimeConfig): boolean {
    return runtime.scheduler.deterministicRuntimeEnabled === false
      && runtime.scheduler.planCompilerEnabled === false
      && runtime.scheduler.toolRoutingMode === 'legacy'
      && runtime.scheduler.runtimeRollout.shadowModeEnabled === false
      && runtime.scheduler.runtimeRollout.canaryPercent === 0
      && runtime.scheduler.runtimeRollout.lanePercents.dryRun === 0
      && runtime.scheduler.runtimeRollout.lanePercents.compile === 0
      && runtime.scheduler.runtimeRollout.lanePercents.replay === 0;
  }

  private toRuntimeRolloutUpdatePayload(runtime: PonyBunnyRuntimeConfig): GatewayRuntimeRolloutUpdatePayload {
    return {
      deterministicRuntimeEnabled: runtime.scheduler.deterministicRuntimeEnabled,
      planCompilerEnabled: runtime.scheduler.planCompilerEnabled,
      toolRoutingMode: runtime.scheduler.toolRoutingMode,
      runtimeRollout: {
        shadowModeEnabled: runtime.scheduler.runtimeRollout.shadowModeEnabled,
        canaryPercent: runtime.scheduler.runtimeRollout.canaryPercent,
        rollbackOnFailure: runtime.scheduler.runtimeRollout.rollbackOnFailure,
        lanePercents: {
          dryRun: runtime.scheduler.runtimeRollout.lanePercents.dryRun,
          compile: runtime.scheduler.runtimeRollout.lanePercents.compile,
          replay: runtime.scheduler.runtimeRollout.lanePercents.replay,
        },
      },
    };
  }

  private readTimestamp(sample: unknown): number {
    const payload = this.asRecord(sample);
    return typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now();
  }

  private asRecord(sample: unknown): Record<string, unknown> | null {
    if (!sample || typeof sample !== 'object') {
      return null;
    }

    return sample as Record<string, unknown>;
  }
}
