import { getSchedulerConfiguredProviderIds } from '../../../src/cli/lib/scheduler-provider-display.js';

jest.mock('../../../src/infra/llm/provider-manager/index.js', () => ({
  getLLMProviderManager: jest.fn(() => ({
    getEnabledEndpoints: () => [
      { id: 'CPA', config: { enabled: true, protocol: 'openai', priority: 1 } },
    ],
  })),
}));

describe('getSchedulerConfiguredProviderIds', () => {
  it('returns enabled provider IDs from llm config view', () => {
    expect(getSchedulerConfiguredProviderIds()).toEqual(['CPA']);
  });
});
