import { jest } from '@jest/globals';

const buildSystemPromptMock = jest.fn(() => ({
  prompt: 'compatibility prompt',
  sections: [],
  metadata: {
    phase: 'execution',
    mode: 'full',
    toolCount: 0,
    skillCount: 0,
    sectionCount: 0,
  },
}));

const readLegacyPromptToolingFallback = jest.fn(() => ({
  skillRegistry: {
    getSkillsForPhase: () => [],
    generateSkillsPrompt: () => '',
  },
  toolProvider: {
    getToolsForPhase: () => [],
  },
}));
const getLegacyCompatiblePromptProvider = jest.fn((createPromptProvider: () => unknown) =>
  createPromptProvider()
);
const setLegacyCompatiblePromptProvider = jest.fn();

jest.mock('../../../src/infra/prompts/system-prompt-builder.js', () => ({
  buildSystemPrompt: buildSystemPromptMock,
}));

jest.mock('../../../src/infra/prompts/legacy-prompt-tooling-compatibility.js', () => ({
  readLegacyPromptToolingFallback,
  getLegacyCompatiblePromptProvider,
  setLegacyCompatiblePromptProvider,
}));

import {
  PromptProvider,
  getGlobalPromptProvider,
  setGlobalPromptProvider,
} from '../../../src/infra/prompts/prompt-provider.js';

describe('PromptProvider compatibility boundary', () => {
  beforeEach(() => {
    buildSystemPromptMock.mockClear();
    readLegacyPromptToolingFallback.mockClear();
    getLegacyCompatiblePromptProvider.mockClear();
    setLegacyCompatiblePromptProvider.mockClear();
  });

  it('reads default skill/tool dependencies through the compatibility helper', () => {
    const provider = new PromptProvider();

    provider.generateExecutionPrompt({
      workspaceDir: '/tmp/workspace',
    });

    expect(readLegacyPromptToolingFallback).toHaveBeenCalledTimes(1);
    expect(buildSystemPromptMock).toHaveBeenCalledTimes(1);
  });

  it('delegates global prompt-provider access and installation to the compatibility helper', () => {
    const provider = getGlobalPromptProvider();
    const installedProvider = new PromptProvider(
      {
        getSkillsForPhase: () => [],
        generateSkillsPrompt: () => '',
      } as never,
      {
        getToolsForPhase: () => [],
      } as never
    );

    setGlobalPromptProvider(installedProvider);

    expect(provider).toBeInstanceOf(PromptProvider);
    expect(getLegacyCompatiblePromptProvider).toHaveBeenCalledTimes(1);
    expect(setLegacyCompatiblePromptProvider).toHaveBeenCalledWith(installedProvider);
  });
});
