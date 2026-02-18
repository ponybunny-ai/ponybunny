import type { ToolCategory } from '../../../domain/permission/types.js';

export type AgentSchemaVersion = 1;

export type AgentSchedule = AgentCronSchedule | AgentIntervalSchedule;

export interface AgentCronSchedule {
  cron: string;
  tz?: string;
  catchUp?: AgentCatchUpPolicy;
}

export interface AgentIntervalSchedule {
  everyMs: number;
  tz?: string;
  catchUp?: AgentCatchUpPolicy;
}

export interface AgentCatchUpPolicy {
  mode?: 'coalesce' | 'catch_up';
  maxCatchUpWindowMs?: number;
  maxRunsPerTick?: number;
}

export interface AgentPolicy {
  toolAllowlist?: string[];
  forbiddenPatterns?: AgentForbiddenPatternConfig[];
  prompts?: Record<string, string>;
  limits?: Record<string, number>;
}

export interface AgentForbiddenPatternConfig {
  pattern: string;
  category?: ToolCategory;
  description?: string;
  severity?: 'high' | 'critical';
  id?: string;
  examples?: string[];
}

export interface AgentRunnerConfig {
  config?: Record<string, unknown>;
}

export interface ReactGoalBudgetConfig {
  tokens?: number;
  time_minutes?: number;
  cost_usd?: number;
}

export interface ReactGoalRunnerConfig {
  goal_title_template: string;
  goal_description_template: string;
  budget?: ReactGoalBudgetConfig;
  model_hint?: string;
  tool_allowlist?: string[];
}

export interface AgentConfig {
  $schema?: string;
  schemaVersion: AgentSchemaVersion;
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  schedule: AgentSchedule;
  policy: AgentPolicy;
  runner: AgentRunnerConfig;
}

export interface CompiledAgentSchedule {
  kind: 'cron' | 'interval';
  cron?: string;
  everyMs?: number;
  tz?: string;
  catchUp: AgentCatchUpPolicy;
}

export interface CompiledAgentConfig extends Omit<AgentConfig, 'schedule'> {
  schedule: CompiledAgentSchedule;
}

export const DEFAULT_CATCH_UP_POLICY: AgentCatchUpPolicy = {
  mode: 'coalesce',
};

export function compileAgentConfig(config: AgentConfig): CompiledAgentConfig {
  const schedule = config.schedule;
  const catchUp = { ...DEFAULT_CATCH_UP_POLICY, ...(schedule.catchUp ?? {}) };

  if ('cron' in schedule) {
    return {
      ...config,
      schedule: {
        kind: 'cron',
        cron: schedule.cron,
        tz: schedule.tz,
        catchUp,
      },
    };
  }

  return {
    ...config,
    schedule: {
      kind: 'interval',
      everyMs: schedule.everyMs,
      tz: schedule.tz,
      catchUp,
    },
  };
}
