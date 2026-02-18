import type { AgentAService } from '../../app/agents/agent-a/agent-a-service.js';
import type { AgentATickInput } from '../../app/agents/agent-a/types.js';
import type { AgentRunner, AgentRunnerInput } from './runner-types.js';

export interface MarketListenerTickDefaults {
  max_sources_per_tick: number;
  max_items_per_source: number;
  default_time_window: string;
}

const DEFAULT_TICK_DEFAULTS: MarketListenerTickDefaults = {
  max_sources_per_tick: 10,
  max_items_per_source: 50,
  default_time_window: '6h',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parsePositiveNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.trunc(value);
};

const parseNonEmptyString = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const resolveMarketListenerTickDefaults = (
  input: AgentRunnerInput
): MarketListenerTickDefaults => {
  const runnerConfig = input.config.runner?.config;
  if (!isRecord(runnerConfig)) {
    return { ...DEFAULT_TICK_DEFAULTS };
  }

  const tickDefaults = isRecord(runnerConfig.tick_defaults)
    ? runnerConfig.tick_defaults
    : undefined;

  return {
    max_sources_per_tick: parsePositiveNumber(
      tickDefaults?.max_sources_per_tick,
      DEFAULT_TICK_DEFAULTS.max_sources_per_tick
    ),
    max_items_per_source: parsePositiveNumber(
      tickDefaults?.max_items_per_source,
      DEFAULT_TICK_DEFAULTS.max_items_per_source
    ),
    default_time_window: parseNonEmptyString(
      tickDefaults?.default_time_window,
      DEFAULT_TICK_DEFAULTS.default_time_window
    ),
  };
};

export class MarketListenerRunner implements AgentRunner {
  constructor(private agentAService: AgentAService) {}

  async runTick(input: AgentRunnerInput): Promise<void> {
    const defaults = resolveMarketListenerTickDefaults(input);
    const tickInput: AgentATickInput = {
      run_id: input.tick.runKey,
      now: input.tick.now.toISOString(),
      max_sources_per_tick: defaults.max_sources_per_tick,
      max_items_per_source: defaults.max_items_per_source,
      default_time_window: defaults.default_time_window,
    };

    await this.agentAService.tick(tickInput);
  }
}
