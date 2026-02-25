import type { ToolCategory } from '../../../domain/permission/types.js';

export type AgentSchemaVersion = 1;

export type AgentSchedule = AgentCronSchedule | AgentIntervalSchedule;

export type AgentScheduleWindowDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface AgentScheduleWindow {
  days: AgentScheduleWindowDay[];
  start: string;
  end: string;
}

export interface AgentCronSchedule {
  enabled?: boolean;
  cron: string;
  tz?: string;
  catchUp?: AgentCatchUpPolicy;
}

export interface AgentIntervalSchedule {
  enabled?: boolean;
  everyMs: number;
  jitterMs?: number;
  timezone?: string;
  tz?: string;
  windows?: AgentScheduleWindow[];
  catchUp?: AgentCatchUpPolicy;
}

export interface AgentCatchUpPolicy {
  mode?: 'coalesce' | 'catch_up' | 'replay' | 'skip';
  maxCatchUpWindowMs?: number;
  maxRunsPerTick?: number;
  maxReplayTicks?: number;
}

export type AgentLimitValue = number | boolean | string;

export interface AgentPolicy {
  toolAllowlist?: string[];
  toolDenylist?: string[];
  skills?: AgentResourcePolicy;
  mcp?: AgentResourcePolicy;
  forbiddenPatterns?: AgentForbiddenPatternConfig[];
  prompts?: Record<string, string>;
  limits?: Record<string, AgentLimitValue>;
  approval?: AgentApprovalPolicy;
  privacy?: AgentPrivacyPolicy;
}

export interface AgentResourcePolicy {
  available?: string[];
  denied?: string[];
}

export interface AgentApprovalPolicy {
  required?: boolean;
  actions?: string[];
  thresholds?: Record<string, number>;
}

export interface AgentPrivacyPolicy {
  redactPiiByDefault?: boolean;
  allowedDataClasses?: Array<
    'public' | 'internal' | 'customer' | 'financial' | 'hr' | 'compliance' | 'sensitive'
  >;
}

export interface AgentForbiddenPatternConfig {
  pattern: string;
  category?: ToolCategory;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  id?: string;
  examples?: string[];
}

export interface AgentRunnerConfig {
  engine?: string;
  entrypoint?: string;
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
  description?: string;
  enabled: boolean;
  type: string;
  workdir?: string;
  subAgents?: string[];
  schedule: AgentSchedule;
  policy: AgentPolicy;
  runner: AgentRunnerConfig;
  ui?: {
    icon?: string;
    accent?: string;
    order?: number;
    group?: string;
  };
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface CompiledAgentSchedule {
  enabled: boolean;
  kind: 'cron' | 'interval';
  cron?: string;
  everyMs?: number;
  jitterMs?: number;
  tz?: string;
  windows?: AgentScheduleWindow[];
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
  const tz = schedule.tz ?? ('timezone' in schedule ? schedule.timezone : undefined);
  const enabled = schedule.enabled ?? false;

  if ('cron' in schedule) {
    return {
      ...config,
      schedule: {
        enabled,
        kind: 'cron',
        cron: schedule.cron,
        tz,
        catchUp,
      },
    };
  }

  return {
    ...config,
    schedule: {
      enabled,
      kind: 'interval',
      everyMs: schedule.everyMs,
      jitterMs: schedule.jitterMs,
      tz,
      windows: schedule.windows,
      catchUp,
    },
  };
}
