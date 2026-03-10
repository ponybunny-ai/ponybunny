import type { ILLMProvider } from '../../infra/llm/llm-provider.js';
import type { ToolEnforcer } from '../../infra/tools/tool-registry.js';
import type { RuntimeToolingContext } from '../tooling-context/index.js';
import { ReActIntegration } from '../../autonomy/react-integration.js';
import type {
  ExecutionCycleRequest,
  ExecutionCycleResult,
  ExecutionCycleRunner,
} from './execution-cycle-runner.js';

interface LocalExecutionCycleRunnerParams {
  llmProvider?: ILLMProvider;
  toolEnforcer: ToolEnforcer;
  runtimeToolingContext: RuntimeToolingContext;
}

export class LocalExecutionCycleRunner implements ExecutionCycleRunner {
  private readonly reactIntegration: ReActIntegration;

  constructor(params: LocalExecutionCycleRunnerParams) {
    this.reactIntegration = new ReActIntegration(
      params.llmProvider,
      params.toolEnforcer,
      undefined,
      undefined,
      params.runtimeToolingContext
    );
  }

  executeCycle(request: ExecutionCycleRequest): Promise<ExecutionCycleResult> {
    return this.reactIntegration.executeWorkCycle(request);
  }
}
