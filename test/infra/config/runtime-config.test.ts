import { resolveRuntimeConfigFromEnvironment } from '../../../src/infra/config/runtime-config.js';

describe('runtime-config memory user profile id', () => {
  it('uses PONY_MEMORY_USER_PROFILE_ID when provided', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_DB_PATH: '/tmp/pony.db',
      PONY_MEMORY_USER_PROFILE_ID: 'alice',
    });

    expect(config.memory.userProfileId).toBe('alice');
    expect(config.memory.database).toBe('/tmp/memory.db');
  });

  it('falls back to detected/default user profile id when env is missing', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_DB_PATH: '/tmp/pony.db',
    });

    expect(typeof config.memory.userProfileId).toBe('string');
    expect(config.memory.userProfileId.length).toBeGreaterThan(0);
  });

  it('loads persona config from environment', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_PERSONA_DIR: '/tmp/personas',
      PONY_DEFAULT_PERSONA_ID: 'pony-pro',
      PONY_PERSONA_OVERRIDE_PERSONALITY: 'Custom personality block',
    });

    expect(config.persona.directory).toBe('/tmp/personas');
    expect(config.persona.defaultPersonaId).toBe('pony-pro');
    expect(config.persona.promptOverrides.personalityDescription).toBe('Custom personality block');
  });

  it('loads scheduler deterministic runtime flags from environment', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_SCHEDULER_DETERMINISTIC_RUNTIME_ENABLED: 'true',
      PONY_SCHEDULER_PLAN_COMPILER_ENABLED: '1',
      PONY_SCHEDULER_TOOL_ROUTING_MODE: 'system_only',
      PONY_SCHEDULER_ALLOW_MODEL_NATIVE_TOOLS: 'true',
      PONY_SCHEDULER_ROLLOUT_SHADOW_ENABLED: 'true',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT: '30',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_DRY_RUN: '40',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_COMPILE: '20',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_REPLAY: '10',
      PONY_SCHEDULER_ROLLOUT_ROLLBACK_ON_FAILURE: '0',
    });

    expect(config.scheduler.deterministicRuntimeEnabled).toBe(true);
    expect(config.scheduler.planCompilerEnabled).toBe(true);
    expect(config.scheduler.toolRoutingMode).toBe('system_only');
    expect(config.scheduler.allowModelNativeTools).toBe(true);
    expect(config.scheduler.runtimeRollout.shadowModeEnabled).toBe(true);
    expect(config.scheduler.runtimeRollout.canaryPercent).toBe(30);
    expect(config.scheduler.runtimeRollout.rollbackOnFailure).toBe(false);
    expect(config.scheduler.runtimeRollout.lanePercents).toEqual({
      dryRun: 40,
      compile: 20,
      replay: 10,
    });
  });

  it('falls back to default tool routing mode for invalid values', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_SCHEDULER_TOOL_ROUTING_MODE: 'invalid-mode',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT: '200',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_DRY_RUN: '-1',
      PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_COMPILE: '150',
    });

    expect(config.scheduler.toolRoutingMode).toBe('legacy');
    expect(config.scheduler.runtimeRollout.canaryPercent).toBe(100);
    expect(config.scheduler.runtimeRollout.lanePercents.dryRun).toBe(0);
    expect(config.scheduler.runtimeRollout.lanePercents.compile).toBe(100);
    expect(config.scheduler.runtimeRollout.lanePercents.replay).toBe(0);
  });

  it('loads run-event retention settings from environment', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_RUN_EVENTS_RETENTION_ENABLED: 'false',
      PONY_RUN_EVENTS_RETENTION_INTERVAL_MS: '900000',
      PONY_RUN_EVENTS_RETENTION_MAX_AGE_MS: '86400000',
      PONY_RUN_EVENTS_RETENTION_KEEP_LATEST_PER_RUN: '12',
    });

    expect(config.scheduler.runEventRetention).toEqual({
      enabled: false,
      intervalMs: 900000,
      maxAgeMs: 86400000,
      keepLatestPerRun: 12,
    });
  });
});
