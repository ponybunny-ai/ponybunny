import type { PromptProvider } from '../../infra/prompts/prompt-provider.js';
import { installLegacyPromptToolingGlobals } from '../../infra/prompts/legacy-prompt-tooling-compatibility.js';
import type { SkillRegistry } from '../../infra/skills/skill-registry.js';
import type { ToolAllowlist, ToolEnforcer, ToolRegistry } from '../../infra/tools/tool-registry.js';
import type { ToolProvider } from '../../infra/tools/tool-provider.js';

export interface RuntimeToolingContext {
  readonly toolRegistry: ToolRegistry;
  readonly toolAllowlist: ToolAllowlist;
  readonly toolEnforcer: ToolEnforcer;
  readonly toolProvider: ToolProvider;
  readonly skillRegistry: SkillRegistry;
  getPromptProvider(): PromptProvider;
  syncLegacyGlobals(): void;
}

interface CreateRuntimeToolingContextParams {
  toolRegistry: ToolRegistry;
  toolAllowlist: ToolAllowlist;
  toolEnforcer: ToolEnforcer;
  toolProvider: ToolProvider;
  skillRegistry: SkillRegistry;
  createPromptProvider: () => PromptProvider;
}

class DefaultRuntimeToolingContext implements RuntimeToolingContext {
  private promptProvider: PromptProvider | null = null;

  constructor(private readonly params: CreateRuntimeToolingContextParams) {}

  get toolRegistry(): ToolRegistry {
    return this.params.toolRegistry;
  }

  get toolAllowlist(): ToolAllowlist {
    return this.params.toolAllowlist;
  }

  get toolEnforcer(): ToolEnforcer {
    return this.params.toolEnforcer;
  }

  get toolProvider(): ToolProvider {
    return this.params.toolProvider;
  }

  get skillRegistry(): SkillRegistry {
    return this.params.skillRegistry;
  }

  getPromptProvider(): PromptProvider {
    if (!this.promptProvider) {
      this.promptProvider = this.params.createPromptProvider();
    }

    return this.promptProvider;
  }

  syncLegacyGlobals(): void {
    installLegacyPromptToolingGlobals({
      toolProvider: this.toolProvider,
      promptProvider: this.getPromptProvider(),
    });
  }
}

export function createRuntimeToolingContext(
  params: CreateRuntimeToolingContextParams
): RuntimeToolingContext {
  return new DefaultRuntimeToolingContext(params);
}
