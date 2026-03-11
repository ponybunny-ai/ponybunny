import { jest } from '@jest/globals';

const installLegacyPromptToolingGlobals = jest.fn();

jest.mock('../../src/infra/prompts/legacy-prompt-tooling-compatibility.js', () => ({
  installLegacyPromptToolingGlobals,
}));

import { createRuntimeToolingContext } from '../../src/runtime/tooling-context/runtime-tooling-context.js';

describe('RuntimeToolingContext legacy compatibility', () => {
  beforeEach(() => {
    installLegacyPromptToolingGlobals.mockClear();
  });

  it('routes syncLegacyGlobals through the shared compatibility installer', () => {
    const promptProvider = { generateExecutionPrompt: jest.fn() } as never;
    const toolProvider = { getToolDefinitions: jest.fn() } as never;
    const runtimeToolingContext = createRuntimeToolingContext({
      toolRegistry: {} as never,
      toolAllowlist: {} as never,
      toolEnforcer: {} as never,
      toolProvider,
      skillRegistry: {} as never,
      createPromptProvider: () => promptProvider,
    });

    runtimeToolingContext.syncLegacyGlobals();

    expect(installLegacyPromptToolingGlobals).toHaveBeenCalledWith({
      toolProvider,
      promptProvider,
    });
  });
});
