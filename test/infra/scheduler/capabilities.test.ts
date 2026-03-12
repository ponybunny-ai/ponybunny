const listAgentCapabilitiesMock = jest.fn();

jest.mock('../../../src/infra/agents/subagent-execution-boundary.js', () => ({
  getGlobalSubagentExecutionBoundary: () => ({
    listAgentCapabilities: listAgentCapabilitiesMock,
  }),
}));

import { getAgentsInfo } from '../../../src/infra/scheduler/capabilities.js';

describe('scheduler capabilities', () => {
  beforeEach(() => {
    listAgentCapabilitiesMock.mockReset();
  });

  it('maps agent capabilities through the subagent execution boundary without changing response shape', async () => {
    listAgentCapabilitiesMock.mockResolvedValue([
      {
        id: 'lead',
        name: 'Lead',
        type: 'growth',
        enabled: true,
        source: 'workspace',
        status: 'valid',
        scheduleKind: 'interval',
        configPath: '/tmp/lead/agent.json',
        configuredWorkdir: './lead-workdir',
      },
    ]);

    const agents = await getAgentsInfo();

    expect(listAgentCapabilitiesMock).toHaveBeenCalledWith({ ensureLoaded: true });
    expect(agents).toEqual([
      {
        id: 'lead',
        name: 'Lead',
        type: 'growth',
        enabled: true,
        source: 'workspace',
        status: 'valid',
        scheduleKind: 'interval',
      },
    ]);
  });
});
