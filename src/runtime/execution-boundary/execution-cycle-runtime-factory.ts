import type { ILLMProvider } from '../../infra/llm/llm-provider.js';
import type { SkillRegistry } from '../../infra/skills/skill-registry.js';
import type { ToolAllowlist, ToolEnforcer, ToolRegistry } from '../../infra/tools/tool-registry.js';
import type { RuntimeToolingContext } from '../tooling-context/index.js';
import type { ExecutionCycleRunner } from './execution-cycle-runner.js';

export interface ExecutionCycleRuntimeFactoryParams {
  llmProvider?: ILLMProvider;
  toolRegistry: ToolRegistry;
  toolAllowlist: ToolAllowlist;
  toolEnforcer: ToolEnforcer;
  skillRegistry: SkillRegistry;
}

export interface ExecutionCycleRuntimeComposition {
  runtimeToolingContext: RuntimeToolingContext;
  executionCycleRunner: ExecutionCycleRunner;
}

export interface ExecutionCycleRuntimeFactory {
  createExecutionCycleRuntime(
    params: ExecutionCycleRuntimeFactoryParams
  ): ExecutionCycleRuntimeComposition;
}
