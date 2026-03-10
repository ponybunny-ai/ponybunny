import { PromptProvider } from '../../infra/prompts/prompt-provider.js';
import { ToolProvider } from '../../infra/tools/tool-provider.js';
import { createRuntimeToolingContext } from '../tooling-context/index.js';
import type {
  ExecutionCycleRuntimeComposition,
  ExecutionCycleRuntimeFactory,
  ExecutionCycleRuntimeFactoryParams,
} from './execution-cycle-runtime-factory.js';
import { LocalExecutionCycleRunner } from './local-execution-cycle-runner.js';

export class LocalExecutionCycleRuntimeFactory implements ExecutionCycleRuntimeFactory {
  createExecutionCycleRuntime(
    params: ExecutionCycleRuntimeFactoryParams
  ): ExecutionCycleRuntimeComposition {
    const toolProvider = new ToolProvider(params.toolEnforcer);
    const runtimeToolingContext = createRuntimeToolingContext({
      toolRegistry: params.toolRegistry,
      toolAllowlist: params.toolAllowlist,
      toolEnforcer: params.toolEnforcer,
      toolProvider,
      skillRegistry: params.skillRegistry,
      createPromptProvider: () => new PromptProvider(params.skillRegistry, toolProvider),
    });

    return {
      runtimeToolingContext,
      executionCycleRunner: new LocalExecutionCycleRunner({
        llmProvider: params.llmProvider,
        toolEnforcer: params.toolEnforcer,
        runtimeToolingContext,
      }),
    };
  }
}
