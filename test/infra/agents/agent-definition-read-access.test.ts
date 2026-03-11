import { RegistryBackedAgentDefinitionReadAccess } from '../../../src/infra/agents/agent-definition-read-access.js';

describe('RegistryBackedAgentDefinitionReadAccess', () => {
  it('returns a narrow read-only definition view for model selection consumers', () => {
    const access = new RegistryBackedAgentDefinitionReadAccess({
      getAgent: (agentId: string) => {
        if (agentId !== 'planner') {
          return undefined;
        }

        return {
          id: 'planner',
          source: 'user',
          status: 'valid',
          definitionHash: 'hash-123',
          config: {
            runner: {
              config: {
                model: 'openai.gpt-5.3',
                model_hint: 'openai.o4-mini',
                ignored: 'value',
              },
            },
          },
        };
      },
    } as never);

    expect(access.getAgentDefinitionView('planner')).toEqual({
      id: 'planner',
      source: 'user',
      status: 'valid',
      definitionHash: 'hash-123',
      runnerModel: 'openai.gpt-5.3',
      runnerModelHint: 'openai.o4-mini',
    });
  });

  it('returns undefined when the registry has no loaded definition for the requested agent', () => {
    const access = new RegistryBackedAgentDefinitionReadAccess({
      getAgent: () => undefined,
    } as never);

    expect(access.getAgentDefinitionView('missing')).toBeUndefined();
  });
});
