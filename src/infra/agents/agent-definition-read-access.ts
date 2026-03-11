import type { AgentConfigSource } from './agent-discovery.js';
import {
  getGlobalAgentRegistry,
  type AgentDefinition,
  type AgentDefinitionStatus,
  type AgentRegistry,
} from './agent-registry.js';

export interface IReadOnlyAgentDefinitionView {
  id: string;
  source: AgentConfigSource;
  status: AgentDefinitionStatus;
  definitionHash: string;
  runnerModel: unknown;
  runnerModelHint: unknown;
}

export interface IAgentDefinitionReadAccess {
  getAgentDefinitionView(agentId: string): IReadOnlyAgentDefinitionView | undefined;
}

function toReadOnlyAgentDefinitionView(agent: AgentDefinition): IReadOnlyAgentDefinitionView {
  const runnerConfig = (agent.config.runner.config ?? {}) as Record<string, unknown>;

  return {
    id: agent.id,
    source: agent.source,
    status: agent.status,
    definitionHash: agent.definitionHash,
    runnerModel: runnerConfig.model,
    runnerModelHint: runnerConfig.model_hint,
  };
}

export class RegistryBackedAgentDefinitionReadAccess implements IAgentDefinitionReadAccess {
  constructor(
    private readonly registry: Pick<AgentRegistry, 'getAgent'>,
  ) {}

  getAgentDefinitionView(agentId: string): IReadOnlyAgentDefinitionView | undefined {
    const agent = this.registry.getAgent(agentId);
    return agent ? toReadOnlyAgentDefinitionView(agent) : undefined;
  }
}

let globalAgentDefinitionReadAccess: IAgentDefinitionReadAccess | null = null;

export function getGlobalAgentDefinitionReadAccess(): IAgentDefinitionReadAccess {
  if (!globalAgentDefinitionReadAccess) {
    globalAgentDefinitionReadAccess = new RegistryBackedAgentDefinitionReadAccess(
      getGlobalAgentRegistry()
    );
  }

  return globalAgentDefinitionReadAccess;
}
