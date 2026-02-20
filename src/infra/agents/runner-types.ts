import type { CompiledAgentConfig } from './config/index.js';
import type { RouteContext } from '../routing/route-context.js';

export interface AgentTickBudget {
  readonly tokens?: number;
  readonly timeMinutes?: number;
  readonly costUsd?: number;
}

export interface AgentTickContext {
  readonly now: Date;
  readonly runKey: string;
  readonly budget?: AgentTickBudget;
  readonly routeContext?: RouteContext;
}

export interface AgentRunnerInput {
  readonly agentId: string;
  readonly config: CompiledAgentConfig;
  readonly tick: AgentTickContext;
}

export interface AgentRunner {
  runTick(input: AgentRunnerInput): Promise<void>;
}
