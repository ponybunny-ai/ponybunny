import type { CompiledAgentConfig } from './config/index.js';
import type { AgentRunner } from './runner-types.js';

export class RunnerRegistry {
  private runners = new Map<string, AgentRunner>();

  register(type: string, runner: AgentRunner): void {
    this.runners.set(type, runner);
  }

  hasRunner(type: string): boolean {
    return this.runners.has(type);
  }

  resolve(agentId: string, config: CompiledAgentConfig): AgentRunner | null {
    const runner = this.runners.get(config.type);
    if (!runner) {
      if (config.enabled) {
        throw new Error(`Unknown runner type '${config.type}' for enabled agent '${agentId}'`);
      }
      return null;
    }

    return runner;
  }
}

let globalRunnerRegistry: RunnerRegistry | null = null;

export function getGlobalRunnerRegistry(): RunnerRegistry {
  if (!globalRunnerRegistry) {
    globalRunnerRegistry = new RunnerRegistry();
  }
  return globalRunnerRegistry;
}
