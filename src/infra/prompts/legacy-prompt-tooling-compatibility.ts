import type { SkillRegistry } from '../skills/skill-registry.js';
import { getGlobalSkillRegistry } from '../skills/skill-registry.js';
import type { ToolProvider } from '../tools/tool-provider.js';
import { getGlobalToolProvider, setGlobalToolProvider } from '../tools/tool-provider.js';
import type { PromptProvider } from './prompt-provider.js';

export interface LegacyPromptToolingFallback {
  skillRegistry: SkillRegistry;
  toolProvider: ToolProvider;
}

export interface LegacyPromptToolingGlobalsInstallation {
  toolProvider?: ToolProvider;
  promptProvider?: PromptProvider;
}

let legacyGlobalPromptProvider: PromptProvider | null = null;

export function readLegacyPromptToolingFallback(): LegacyPromptToolingFallback {
  return {
    skillRegistry: getGlobalSkillRegistry(),
    toolProvider: getGlobalToolProvider(),
  };
}

export function getLegacyCompatibleToolProvider(): ToolProvider {
  return getGlobalToolProvider();
}

export function getLegacyCompatiblePromptProvider(
  createPromptProvider: () => PromptProvider
): PromptProvider {
  if (!legacyGlobalPromptProvider) {
    legacyGlobalPromptProvider = createPromptProvider();
  }

  return legacyGlobalPromptProvider;
}

export function setLegacyCompatiblePromptProvider(provider: PromptProvider): void {
  legacyGlobalPromptProvider = provider;
}

export function installLegacyPromptToolingGlobals(
  installation: LegacyPromptToolingGlobalsInstallation
): void {
  if (installation.toolProvider) {
    setGlobalToolProvider(installation.toolProvider);
  }

  if (installation.promptProvider) {
    legacyGlobalPromptProvider = installation.promptProvider;
  }
}
