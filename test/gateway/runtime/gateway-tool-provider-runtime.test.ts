const configureLLMProviderManagerStreamEventSink = jest.fn();
const setGlobalToolProvider = jest.fn();

jest.mock('../../../src/infra/llm/provider-manager/index.js', () => ({
  configureLLMProviderManagerStreamEventSink,
}));

jest.mock('../../../src/infra/tools/tool-provider.js', () => {
  const actual = jest.requireActual('../../../src/infra/tools/tool-provider.js');

  return {
    ...actual,
    setGlobalToolProvider,
  };
});

import { createNoOpLLMStreamEventSink } from '../../../src/infra/llm/provider-manager/stream-event-sink.js';
import { GatewayToolProviderRuntime } from '../../../src/gateway/runtime/gateway-tool-provider-runtime.js';

describe('GatewayToolProviderRuntime', () => {
  beforeEach(() => {
    configureLLMProviderManagerStreamEventSink.mockReset();
    setGlobalToolProvider.mockReset();
  });

  it('assembles the gateway tool/provider graph and binds the global provider mirror', () => {
    const streamEventSink = createNoOpLLMStreamEventSink();
    const runtime = new GatewayToolProviderRuntime({ streamEventSink });
    const providedToolNames = runtime.toolProvider.getToolDefinitions().map((tool) => tool.name);

    expect(runtime.toolRegistry.getAllTools().map((tool) => tool.name)).toEqual([
      'read_file',
      'write_file',
      'execute_command',
      'search_code',
      'web_search',
      'find_skills',
    ]);
    expect(runtime.toolAllowlist.getAllowedTools()).toEqual([
      'read_file',
      'write_file',
      'execute_command',
      'search_code',
      'web_search',
      'find_skills',
    ]);
    expect(runtime.toolEnforcer.registry).toBe(runtime.toolRegistry);
    expect(runtime.toolEnforcer.allowlist).toBe(runtime.toolAllowlist);
    expect(providedToolNames).toEqual(expect.arrayContaining([
      'read_file',
      'write_file',
      'execute_command',
      'search_code',
      'web_search',
      'find_skills',
    ]));
    expect(setGlobalToolProvider).toHaveBeenCalledWith(runtime.toolProvider);
    expect(configureLLMProviderManagerStreamEventSink).toHaveBeenCalledWith(streamEventSink);
  });
});
