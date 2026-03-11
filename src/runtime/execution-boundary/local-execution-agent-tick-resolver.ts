import type { AgentDefinition, AgentRegistry } from '../../infra/agents/agent-registry.js';
import type { RunnerRegistry } from '../../infra/agents/runner-registry.js';
import type { AgentRunner } from '../../infra/agents/runner-types.js';

export interface LocalExecutionAgentTickResolver {
  getDefinition(agentId: string): AgentDefinition | undefined;
  hasRunnerPath(definition: AgentDefinition): boolean;
  resolveRunner(definition: AgentDefinition): AgentRunner | null;
}

export class RegistryBackedLocalExecutionAgentTickResolver implements LocalExecutionAgentTickResolver {
  constructor(
    private readonly agentRegistry: Pick<AgentRegistry, 'getAgent'>,
    private readonly runnerRegistry: Pick<RunnerRegistry, 'hasRunner' | 'resolve'>
  ) {}

  getDefinition(agentId: string): AgentDefinition | undefined {
    return this.agentRegistry.getAgent(agentId);
  }

  hasRunnerPath(definition: AgentDefinition): boolean {
    const configuredEngine = definition.config.runner?.engine?.trim();
    const hasTypeRunner = this.runnerRegistry.hasRunner(definition.config.type);
    const hasExplicitEngineRunner =
      !!configuredEngine
      && configuredEngine.length > 0
      && this.runnerRegistry.hasRunner(configuredEngine);

    return (
      hasTypeRunner
      || (configuredEngine !== undefined && configuredEngine !== 'default' && hasExplicitEngineRunner)
    );
  }

  resolveRunner(definition: AgentDefinition): AgentRunner | null {
    return this.runnerRegistry.resolve(definition.id, definition.config);
  }
}
