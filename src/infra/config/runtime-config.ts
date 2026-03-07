import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { getConfigDir } from './config-paths.js';

export interface PonyBunnyRuntimeConfig {
  $schema?: string;
  paths: {
    database: string;
    schedulerSocket: string;
  };
  gateway: {
    host: string;
    port: number;
  };
  scheduler: {
    tickIntervalMs: number;
    maxConcurrentGoals: number;
    agentsEnabled: boolean;
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
    allowModelNativeTools: boolean;
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
    runEventRetention: {
      enabled: boolean;
      intervalMs: number;
      maxAgeMs: number;
      keepLatestPerRun: number;
    };
  };
  agent: {
    mainAgentId: string;
    personaEnabled: boolean;
  };
  persona: {
    directory: string;
    defaultPersonaId: string;
    promptOverrides: {
      personalityDescription: string;
      communicationStyleDescription: string;
      expertiseDescription: string;
      guidelines: string;
      backstory: string;
    };
  };
  debug: {
    serverPort: number;
    loggingEnabled: boolean;
    antigravityDebug: boolean;
  };
  memory: {
    backend: 'sqlite' | 'memory';
    database: string;
    userProfileId: string;
    autoSave: boolean;
    embeddingProvider: string;
    vectorWeight: number;
    keywordWeight: number;
  };
  tui: {
    inputBackgroundColor: 'gray' | 'black' | 'blue' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'white';
    sessionFirstEnabled: boolean;
    goalSubmitFastPathEnabled: boolean;
  };
}

const PONY_DIR = path.join(homedir(), '.ponybunny');
const CONFIG_DIR = getConfigDir();
const DEFAULT_USER_PROFILE_ID = detectCurrentOsUserProfileId();

export const DEFAULT_RUNTIME_CONFIG: PonyBunnyRuntimeConfig = {
  $schema: 'https://ponybunny.dho.ai/schemas/ponybunny.schema.json',
  paths: {
    database: path.join(PONY_DIR, 'pony.db'),
    schedulerSocket: path.join(PONY_DIR, 'gateway.sock'),
  },
  gateway: {
    host: '127.0.0.1',
    port: 18789,
  },
  scheduler: {
    tickIntervalMs: 1000,
    maxConcurrentGoals: 5,
    agentsEnabled: true,
    deterministicRuntimeEnabled: false,
    planCompilerEnabled: false,
    toolRoutingMode: 'legacy',
    allowModelNativeTools: false,
    runtimeRollout: {
      shadowModeEnabled: false,
      canaryPercent: 0,
      rollbackOnFailure: true,
      lanePercents: {
        dryRun: 0,
        compile: 0,
        replay: 0,
      },
    },
    runEventRetention: {
      enabled: true,
      intervalMs: 60 * 60 * 1000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      keepLatestPerRun: 50,
    },
  },
  agent: {
    mainAgentId: 'lead',
    personaEnabled: false,
  },
  persona: {
    directory: path.join(CONFIG_DIR, 'personas'),
    defaultPersonaId: 'pony-default',
    promptOverrides: {
      personalityDescription: '',
      communicationStyleDescription: '',
      expertiseDescription: '',
      guidelines: '',
      backstory: '',
    },
  },
  debug: {
    serverPort: 3001,
    loggingEnabled: false,
    antigravityDebug: false,
  },
  memory: {
    backend: 'sqlite',
    database: path.join(PONY_DIR, 'memory.db'),
    userProfileId: DEFAULT_USER_PROFILE_ID,
    autoSave: true,
    embeddingProvider: 'none',
    vectorWeight: 0.7,
    keywordWeight: 0.3,
  },
  tui: {
    inputBackgroundColor: 'black',
    sessionFirstEnabled: true,
    goalSubmitFastPathEnabled: false,
  },
};

export function getRuntimeConfigPath(): string {
  return path.join(getConfigDir(), 'ponybunny.json');
}

export function getRuntimeSchemaPath(): string {
  return path.join(getConfigDir(), 'ponybunny.schema.json');
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }

  return fallback;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function expandHomePath(input: string): string {
  if (input === '~') {
    return homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

function toToolRoutingMode(
  value: unknown,
  fallback: PonyBunnyRuntimeConfig['scheduler']['toolRoutingMode']
): PonyBunnyRuntimeConfig['scheduler']['toolRoutingMode'] {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'legacy'
    || normalized === 'system_only'
    || normalized === 'system_preferred'
    || normalized === 'model_preferred'
  ) {
    return normalized;
  }

  return fallback;
}

function toNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(max, Math.max(min, parsed));
  }
  return fallback;
}

function toIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (Number.isInteger(parsed)) {
    return Math.min(max, Math.max(min, parsed));
  }
  return fallback;
}

function defaultMemoryDbPath(mainDbPath: string): string {
  return path.join(path.dirname(mainDbPath), 'memory.db');
}

function detectCurrentOsUserProfileId(): string {
  const idUser = runUsernameCommand('id -un');
  if (idUser) {
    return idUser;
  }

  const whoamiUser = runUsernameCommand('whoami');
  if (whoamiUser) {
    return whoamiUser;
  }

  const envUser = process.env.USER || process.env.LOGNAME;
  if (typeof envUser === 'string' && envUser.trim().length > 0) {
    return envUser.trim();
  }

  return 'local-default-user';
}

function runUsernameCommand(command: string): string | null {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

export function resolveRuntimeConfigFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): PonyBunnyRuntimeConfig {
  const mainDatabase = path.resolve(expandHomePath(toStringValue(env.PONY_DB_PATH, DEFAULT_RUNTIME_CONFIG.paths.database)));
  const memoryDatabase = toStringValue(
    env.PONY_MEMORY_DB_PATH,
    defaultMemoryDbPath(mainDatabase)
  );

  return {
    ...DEFAULT_RUNTIME_CONFIG,
    paths: {
      database: mainDatabase,
      schedulerSocket: path.resolve(expandHomePath(toStringValue(env.PONY_SCHEDULER_SOCKET, DEFAULT_RUNTIME_CONFIG.paths.schedulerSocket))),
    },
    gateway: {
      host: toStringValue(env.PONY_GATEWAY_HOST, DEFAULT_RUNTIME_CONFIG.gateway.host),
      port: toPositiveInt(env.PONY_GATEWAY_PORT, DEFAULT_RUNTIME_CONFIG.gateway.port),
    },
    scheduler: {
      tickIntervalMs: toPositiveInt(env.PONY_SCHEDULER_TICK_MS, DEFAULT_RUNTIME_CONFIG.scheduler.tickIntervalMs),
      maxConcurrentGoals: toPositiveInt(
        env.PONY_SCHEDULER_MAX_CONCURRENT_GOALS,
        DEFAULT_RUNTIME_CONFIG.scheduler.maxConcurrentGoals
      ),
      agentsEnabled: toBoolean(env.PONY_SCHEDULER_AGENTS_ENABLED, DEFAULT_RUNTIME_CONFIG.scheduler.agentsEnabled),
      deterministicRuntimeEnabled: toBoolean(
        env.PONY_SCHEDULER_DETERMINISTIC_RUNTIME_ENABLED,
        DEFAULT_RUNTIME_CONFIG.scheduler.deterministicRuntimeEnabled
      ),
      planCompilerEnabled: toBoolean(
        env.PONY_SCHEDULER_PLAN_COMPILER_ENABLED,
        DEFAULT_RUNTIME_CONFIG.scheduler.planCompilerEnabled
      ),
      toolRoutingMode: toToolRoutingMode(
        env.PONY_SCHEDULER_TOOL_ROUTING_MODE,
        DEFAULT_RUNTIME_CONFIG.scheduler.toolRoutingMode
      ),
      allowModelNativeTools: toBoolean(
        env.PONY_SCHEDULER_ALLOW_MODEL_NATIVE_TOOLS,
        DEFAULT_RUNTIME_CONFIG.scheduler.allowModelNativeTools
      ),
      runtimeRollout: {
        shadowModeEnabled: toBoolean(
          env.PONY_SCHEDULER_ROLLOUT_SHADOW_ENABLED,
          DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.shadowModeEnabled
        ),
        canaryPercent: toIntegerInRange(
          env.PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT,
          DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.canaryPercent,
          0,
          100
        ),
        rollbackOnFailure: toBoolean(
          env.PONY_SCHEDULER_ROLLOUT_ROLLBACK_ON_FAILURE,
          DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.rollbackOnFailure
        ),
        lanePercents: {
          dryRun: toIntegerInRange(
            env.PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_DRY_RUN,
            DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.lanePercents.dryRun,
            0,
            100
          ),
          compile: toIntegerInRange(
            env.PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_COMPILE,
            DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.lanePercents.compile,
            0,
            100
          ),
          replay: toIntegerInRange(
            env.PONY_SCHEDULER_ROLLOUT_CANARY_PERCENT_REPLAY,
            DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.lanePercents.replay,
            0,
            100
          ),
        },
      },
      runEventRetention: {
        enabled: toBoolean(
          env.PONY_RUN_EVENTS_RETENTION_ENABLED,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.enabled
        ),
        intervalMs: toPositiveInt(
          env.PONY_RUN_EVENTS_RETENTION_INTERVAL_MS,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.intervalMs
        ),
        maxAgeMs: toPositiveInt(
          env.PONY_RUN_EVENTS_RETENTION_MAX_AGE_MS,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.maxAgeMs
        ),
        keepLatestPerRun: toIntegerInRange(
          env.PONY_RUN_EVENTS_RETENTION_KEEP_LATEST_PER_RUN,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.keepLatestPerRun,
          0,
          10000
        ),
      },
    },
    agent: {
      mainAgentId: toStringValue(env.PONY_MAIN_AGENT_ID, DEFAULT_RUNTIME_CONFIG.agent.mainAgentId),
      personaEnabled: toBoolean(env.PONY_AGENT_PERSONA_ENABLED, DEFAULT_RUNTIME_CONFIG.agent.personaEnabled),
    },
    persona: {
      directory: path.resolve(expandHomePath(toStringValue(env.PONY_PERSONA_DIR, DEFAULT_RUNTIME_CONFIG.persona.directory))),
      defaultPersonaId: toStringValue(env.PONY_DEFAULT_PERSONA_ID, DEFAULT_RUNTIME_CONFIG.persona.defaultPersonaId),
      promptOverrides: {
        personalityDescription: toStringValue(
          env.PONY_PERSONA_OVERRIDE_PERSONALITY,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.personalityDescription
        ),
        communicationStyleDescription: toStringValue(
          env.PONY_PERSONA_OVERRIDE_COMMUNICATION_STYLE,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.communicationStyleDescription
        ),
        expertiseDescription: toStringValue(
          env.PONY_PERSONA_OVERRIDE_EXPERTISE,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.expertiseDescription
        ),
        guidelines: toStringValue(
          env.PONY_PERSONA_OVERRIDE_GUIDELINES,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.guidelines
        ),
        backstory: toStringValue(
          env.PONY_PERSONA_OVERRIDE_BACKSTORY,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.backstory
        ),
      },
    },
    debug: {
      serverPort: toPositiveInt(env.DEBUG_SERVER_PORT, DEFAULT_RUNTIME_CONFIG.debug.serverPort),
      loggingEnabled: env.PONY_BUNNY_DEBUG === '1',
      antigravityDebug: env.PB_ANTIGRAVITY_DEBUG === '1',
    },
    memory: {
      backend: env.PONY_MEMORY_BACKEND === 'memory' ? 'memory' : 'sqlite',
      database: path.resolve(expandHomePath(memoryDatabase)),
      userProfileId: toStringValue(env.PONY_MEMORY_USER_PROFILE_ID, DEFAULT_RUNTIME_CONFIG.memory.userProfileId),
      autoSave: toBoolean(env.PONY_MEMORY_AUTO_SAVE, DEFAULT_RUNTIME_CONFIG.memory.autoSave),
      embeddingProvider: toStringValue(env.PONY_MEMORY_EMBEDDING_PROVIDER, DEFAULT_RUNTIME_CONFIG.memory.embeddingProvider),
      vectorWeight: toNumberInRange(env.PONY_MEMORY_VECTOR_WEIGHT, DEFAULT_RUNTIME_CONFIG.memory.vectorWeight, 0, 1),
      keywordWeight: toNumberInRange(env.PONY_MEMORY_KEYWORD_WEIGHT, DEFAULT_RUNTIME_CONFIG.memory.keywordWeight, 0, 1),
    },
    tui: {
      inputBackgroundColor: toInputBackgroundColor(
        env.PONY_TUI_INPUT_BACKGROUND_COLOR,
        DEFAULT_RUNTIME_CONFIG.tui.inputBackgroundColor
      ),
      sessionFirstEnabled: toBoolean(
        env.PONY_TUI_SESSION_FIRST_ENABLED,
        DEFAULT_RUNTIME_CONFIG.tui.sessionFirstEnabled
      ),
      goalSubmitFastPathEnabled: toBoolean(
        env.PONY_TUI_GOAL_SUBMIT_FAST_PATH_ENABLED,
        DEFAULT_RUNTIME_CONFIG.tui.goalSubmitFastPathEnabled
      ),
    },
  };
}

function toInputBackgroundColor(
  value: unknown,
  fallback: PonyBunnyRuntimeConfig['tui']['inputBackgroundColor']
): PonyBunnyRuntimeConfig['tui']['inputBackgroundColor'] {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'gray'
    || normalized === 'black'
    || normalized === 'blue'
    || normalized === 'green'
    || normalized === 'yellow'
    || normalized === 'magenta'
    || normalized === 'cyan'
    || normalized === 'white'
  ) {
    return normalized;
  }

  return fallback;
}

function deepMerge<T extends Record<string, unknown>>(base: T, value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    return { ...base };
  }

  const source = value as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base };

  for (const key of Object.keys(source)) {
    const baseValue = merged[key];
    const sourceValue = source[key];

    if (
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue)
    ) {
      merged[key] = deepMerge(baseValue as Record<string, unknown>, sourceValue);
    } else {
      merged[key] = sourceValue;
    }
  }

  return merged as T;
}

function normalizeConfig(raw: PonyBunnyRuntimeConfig): PonyBunnyRuntimeConfig {
  const memoryInput = (raw as unknown as { memory?: Record<string, unknown> }).memory ?? {};
  const personaInput = (raw as unknown as { persona?: Record<string, unknown> }).persona ?? {};
  const schedulerInput = (raw as unknown as { scheduler?: Record<string, unknown> }).scheduler ?? {};
  const runtimeRolloutInput =
    (schedulerInput.runtimeRollout as Record<string, unknown> | undefined)
    ?? (schedulerInput.runtime_rollout as Record<string, unknown> | undefined)
    ?? {};
  const runEventRetentionInput =
    (schedulerInput.runEventRetention as Record<string, unknown> | undefined)
    ?? (schedulerInput.run_event_retention as Record<string, unknown> | undefined)
    ?? {};
  const promptOverrideInput =
    (personaInput.promptOverrides as Record<string, unknown> | undefined)
    ?? (personaInput.prompt_overrides as Record<string, unknown> | undefined)
    ?? {};
  const normalizedMainDbPath = path.resolve(
    expandHomePath(toStringValue(raw.paths?.database, DEFAULT_RUNTIME_CONFIG.paths.database))
  );
  const memoryDatabaseValue = memoryInput.database ?? memoryInput.db;
  const userProfileIdValue = memoryInput.userProfileId ?? memoryInput.user_profile_id;
  const autoSaveValue = memoryInput.autoSave ?? memoryInput.auto_save;
  const embeddingProviderValue = memoryInput.embeddingProvider ?? memoryInput.embedding_provider;
  const vectorWeightValue = memoryInput.vectorWeight ?? memoryInput.vector_weight;
  const keywordWeightValue = memoryInput.keywordWeight ?? memoryInput.keyword_weight;

  return {
    $schema: 'https://ponybunny.dho.ai/schemas/ponybunny.schema.json',
    paths: {
      database: normalizedMainDbPath,
      schedulerSocket: path.resolve(
        expandHomePath(toStringValue(raw.paths?.schedulerSocket, DEFAULT_RUNTIME_CONFIG.paths.schedulerSocket))
      ),
    },
    gateway: {
      host: toStringValue(raw.gateway?.host, DEFAULT_RUNTIME_CONFIG.gateway.host),
      port: toPositiveInt(raw.gateway?.port, DEFAULT_RUNTIME_CONFIG.gateway.port),
    },
    scheduler: {
      tickIntervalMs: toPositiveInt(raw.scheduler?.tickIntervalMs, DEFAULT_RUNTIME_CONFIG.scheduler.tickIntervalMs),
      maxConcurrentGoals: toPositiveInt(
        raw.scheduler?.maxConcurrentGoals,
        DEFAULT_RUNTIME_CONFIG.scheduler.maxConcurrentGoals
      ),
      agentsEnabled: toBoolean(raw.scheduler?.agentsEnabled, DEFAULT_RUNTIME_CONFIG.scheduler.agentsEnabled),
      deterministicRuntimeEnabled: toBoolean(
        raw.scheduler?.deterministicRuntimeEnabled,
        DEFAULT_RUNTIME_CONFIG.scheduler.deterministicRuntimeEnabled
      ),
      planCompilerEnabled: toBoolean(
        raw.scheduler?.planCompilerEnabled,
        DEFAULT_RUNTIME_CONFIG.scheduler.planCompilerEnabled
      ),
      toolRoutingMode: toToolRoutingMode(
        raw.scheduler?.toolRoutingMode,
        DEFAULT_RUNTIME_CONFIG.scheduler.toolRoutingMode
      ),
      allowModelNativeTools: toBoolean(
        raw.scheduler?.allowModelNativeTools,
        DEFAULT_RUNTIME_CONFIG.scheduler.allowModelNativeTools
      ),
      runtimeRollout: {
        shadowModeEnabled: toBoolean(
          runtimeRolloutInput.shadowModeEnabled ?? runtimeRolloutInput.shadow_mode_enabled,
          DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.shadowModeEnabled
        ),
        canaryPercent: toIntegerInRange(
          runtimeRolloutInput.canaryPercent ?? runtimeRolloutInput.canary_percent,
          DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.canaryPercent,
          0,
          100
        ),
        rollbackOnFailure: toBoolean(
          runtimeRolloutInput.rollbackOnFailure ?? runtimeRolloutInput.rollback_on_failure,
          DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.rollbackOnFailure
        ),
        lanePercents: {
          dryRun: toIntegerInRange(
            (runtimeRolloutInput.lanePercents as Record<string, unknown> | undefined)?.dryRun
              ?? (runtimeRolloutInput.lane_percents as Record<string, unknown> | undefined)?.dry_run,
            DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.lanePercents.dryRun,
            0,
            100
          ),
          compile: toIntegerInRange(
            (runtimeRolloutInput.lanePercents as Record<string, unknown> | undefined)?.compile
              ?? (runtimeRolloutInput.lane_percents as Record<string, unknown> | undefined)?.compile,
            DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.lanePercents.compile,
            0,
            100
          ),
          replay: toIntegerInRange(
            (runtimeRolloutInput.lanePercents as Record<string, unknown> | undefined)?.replay
              ?? (runtimeRolloutInput.lane_percents as Record<string, unknown> | undefined)?.replay,
            DEFAULT_RUNTIME_CONFIG.scheduler.runtimeRollout.lanePercents.replay,
            0,
            100
          ),
        },
      },
      runEventRetention: {
        enabled: toBoolean(
          runEventRetentionInput.enabled,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.enabled
        ),
        intervalMs: toPositiveInt(
          runEventRetentionInput.intervalMs ?? runEventRetentionInput.interval_ms,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.intervalMs
        ),
        maxAgeMs: toPositiveInt(
          runEventRetentionInput.maxAgeMs ?? runEventRetentionInput.max_age_ms,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.maxAgeMs
        ),
        keepLatestPerRun: toIntegerInRange(
          runEventRetentionInput.keepLatestPerRun ?? runEventRetentionInput.keep_latest_per_run,
          DEFAULT_RUNTIME_CONFIG.scheduler.runEventRetention.keepLatestPerRun,
          0,
          10000
        ),
      },
    },
    agent: {
      mainAgentId: toStringValue(raw.agent?.mainAgentId, DEFAULT_RUNTIME_CONFIG.agent.mainAgentId),
      personaEnabled: toBoolean(raw.agent?.personaEnabled, DEFAULT_RUNTIME_CONFIG.agent.personaEnabled),
    },
    persona: {
      directory: path.resolve(expandHomePath(toStringValue(personaInput.directory, DEFAULT_RUNTIME_CONFIG.persona.directory))),
      defaultPersonaId: toStringValue(personaInput.defaultPersonaId, DEFAULT_RUNTIME_CONFIG.persona.defaultPersonaId),
      promptOverrides: {
        personalityDescription: toStringValue(
          promptOverrideInput.personalityDescription ?? promptOverrideInput.personality_description,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.personalityDescription
        ),
        communicationStyleDescription: toStringValue(
          promptOverrideInput.communicationStyleDescription ?? promptOverrideInput.communication_style_description,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.communicationStyleDescription
        ),
        expertiseDescription: toStringValue(
          promptOverrideInput.expertiseDescription ?? promptOverrideInput.expertise_description,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.expertiseDescription
        ),
        guidelines: toStringValue(
          promptOverrideInput.guidelines,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.guidelines
        ),
        backstory: toStringValue(
          promptOverrideInput.backstory,
          DEFAULT_RUNTIME_CONFIG.persona.promptOverrides.backstory
        ),
      },
    },
    debug: {
      serverPort: toPositiveInt(raw.debug?.serverPort, DEFAULT_RUNTIME_CONFIG.debug.serverPort),
      loggingEnabled: toBoolean(raw.debug?.loggingEnabled, DEFAULT_RUNTIME_CONFIG.debug.loggingEnabled),
      antigravityDebug: toBoolean(raw.debug?.antigravityDebug, DEFAULT_RUNTIME_CONFIG.debug.antigravityDebug),
    },
    memory: {
      backend: memoryInput.backend === 'memory' ? 'memory' : 'sqlite',
      database: path.resolve(
        expandHomePath(toStringValue(memoryDatabaseValue, defaultMemoryDbPath(normalizedMainDbPath)))
      ),
      userProfileId: toStringValue(userProfileIdValue, DEFAULT_RUNTIME_CONFIG.memory.userProfileId),
      autoSave: toBoolean(autoSaveValue, DEFAULT_RUNTIME_CONFIG.memory.autoSave),
      embeddingProvider: toStringValue(embeddingProviderValue, DEFAULT_RUNTIME_CONFIG.memory.embeddingProvider),
      vectorWeight: toNumberInRange(vectorWeightValue, DEFAULT_RUNTIME_CONFIG.memory.vectorWeight, 0, 1),
      keywordWeight: toNumberInRange(keywordWeightValue, DEFAULT_RUNTIME_CONFIG.memory.keywordWeight, 0, 1),
    },
    tui: {
      inputBackgroundColor: toInputBackgroundColor(
        (raw as unknown as { tui?: { inputBackgroundColor?: unknown } }).tui?.inputBackgroundColor,
        DEFAULT_RUNTIME_CONFIG.tui.inputBackgroundColor
      ),
      sessionFirstEnabled: toBoolean(
        (raw as unknown as { tui?: { session_first_enabled?: unknown; sessionFirstEnabled?: unknown } }).tui?.session_first_enabled
          ?? (raw as unknown as { tui?: { sessionFirstEnabled?: unknown } }).tui?.sessionFirstEnabled,
        DEFAULT_RUNTIME_CONFIG.tui.sessionFirstEnabled
      ),
      goalSubmitFastPathEnabled: toBoolean(
        (raw as unknown as { tui?: { goal_submit_fast_path_enabled?: unknown; goalSubmitFastPathEnabled?: unknown } }).tui?.goal_submit_fast_path_enabled
          ?? (raw as unknown as { tui?: { goalSubmitFastPathEnabled?: unknown } }).tui?.goalSubmitFastPathEnabled,
        DEFAULT_RUNTIME_CONFIG.tui.goalSubmitFastPathEnabled
      ),
    },
  };
}

export function loadRuntimeConfig(): PonyBunnyRuntimeConfig {
  const configPath = getRuntimeConfigPath();

  if (!fs.existsSync(configPath)) {
    return normalizeConfig(DEFAULT_RUNTIME_CONFIG);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return normalizeConfig(deepMerge(DEFAULT_RUNTIME_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as PonyBunnyRuntimeConfig);
  } catch {
    return normalizeConfig(DEFAULT_RUNTIME_CONFIG);
  }
}

export function saveRuntimeConfig(config: PonyBunnyRuntimeConfig): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(getRuntimeConfigPath(), JSON.stringify(normalizeConfig(config), null, 2), { mode: 0o600 });
}
