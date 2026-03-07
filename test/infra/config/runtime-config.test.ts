import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_RUNTIME_CONFIG,
  loadRuntimeConfig,
  resolveRuntimeConfigFromEnvironment,
} from '../../../src/infra/config/runtime-config.js';

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

  it('expands tilde paths from environment variables', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_DB_PATH: '~/.ponybunny/custom-pony.db',
      PONY_SCHEDULER_SOCKET: '~/.ponybunny/custom-gateway.sock',
      PONY_MEMORY_DB_PATH: '~/.ponybunny/custom-memory.db',
      PONY_PERSONA_DIR: '~/.config/ponybunny/custom-personas',
    });

    expect(config.paths.database).toBe(path.join(os.homedir(), '.ponybunny', 'custom-pony.db'));
    expect(config.paths.schedulerSocket).toBe(path.join(os.homedir(), '.ponybunny', 'custom-gateway.sock'));
    expect(config.memory.database).toBe(path.join(os.homedir(), '.ponybunny', 'custom-memory.db'));
    expect(config.persona.directory).toBe(path.join(os.homedir(), '.config', 'ponybunny', 'custom-personas'));
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

  it('loads TUI input routing flags from environment', () => {
    const config = resolveRuntimeConfigFromEnvironment({
      PONY_TUI_SESSION_FIRST_ENABLED: 'false',
      PONY_TUI_GOAL_SUBMIT_FAST_PATH_ENABLED: 'true',
    });

    expect(config.tui.sessionFirstEnabled).toBe(false);
    expect(config.tui.goalSubmitFastPathEnabled).toBe(true);
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

  it('uses default TUI routing flags when env overrides are absent', () => {
    const config = resolveRuntimeConfigFromEnvironment({});

    expect(config.tui.sessionFirstEnabled).toBe(DEFAULT_RUNTIME_CONFIG.tui.sessionFirstEnabled);
    expect(config.tui.goalSubmitFastPathEnabled).toBe(DEFAULT_RUNTIME_CONFIG.tui.goalSubmitFastPathEnabled);
  });

  it('reads TUI routing flags from ponybunny.json and normalizes snake_case aliases', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-runtime-config-'));
    const previousConfigDir = process.env.PONYBUNNY_CONFIG_DIR;
    process.env.PONYBUNNY_CONFIG_DIR = tempRoot;

    try {
      const payload = {
        tui: {
          inputBackgroundColor: 'black',
          session_first_enabled: false,
          goal_submit_fast_path_enabled: true,
        },
      };

      fs.writeFileSync(
        path.join(tempRoot, 'ponybunny.json'),
        JSON.stringify(payload, null, 2),
        'utf-8'
      );

      const loaded = loadRuntimeConfig();
      expect(loaded.tui.sessionFirstEnabled).toBe(false);
      expect(loaded.tui.goalSubmitFastPathEnabled).toBe(true);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.PONYBUNNY_CONFIG_DIR;
      } else {
        process.env.PONYBUNNY_CONFIG_DIR = previousConfigDir;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('expands tilde paths from ponybunny.json runtime file', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-runtime-config-'));
    const previousConfigDir = process.env.PONYBUNNY_CONFIG_DIR;
    process.env.PONYBUNNY_CONFIG_DIR = tempRoot;

    try {
      const payload = {
        paths: {
          database: '~/.ponybunny/pony.db',
          schedulerSocket: '~/.ponybunny/gateway.sock',
        },
        persona: {
          directory: '~/.config/ponybunny/personas',
        },
        memory: {
          database: '~/.ponybunny/memory.db',
        },
      };

      fs.writeFileSync(
        path.join(tempRoot, 'ponybunny.json'),
        JSON.stringify(payload, null, 2),
        'utf-8'
      );

      const loaded = loadRuntimeConfig();
      expect(loaded.paths.database).toBe(path.join(os.homedir(), '.ponybunny', 'pony.db'));
      expect(loaded.paths.schedulerSocket).toBe(path.join(os.homedir(), '.ponybunny', 'gateway.sock'));
      expect(loaded.persona.directory).toBe(path.join(os.homedir(), '.config', 'ponybunny', 'personas'));
      expect(loaded.memory.database).toBe(path.join(os.homedir(), '.ponybunny', 'memory.db'));
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.PONYBUNNY_CONFIG_DIR;
      } else {
        process.env.PONYBUNNY_CONFIG_DIR = previousConfigDir;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
