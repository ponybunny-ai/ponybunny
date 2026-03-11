import type { CompiledAgentConfig } from './config/index.js';
import type { AgentRunner } from './runner-types.js';

export interface RunnerRegistration {
  type: string;
  runner: AgentRunner;
}

export class RunnerRegistry {
  private runners = new Map<string, AgentRunner>();

  register(type: string, runner: AgentRunner): void {
    this.runners.set(type, runner);
  }

  registerMany(registrations: Iterable<RunnerRegistration>): void {
    for (const registration of registrations) {
      this.register(registration.type, registration.runner);
    }
  }

  hasRunner(type: string): boolean {
    return this.runners.has(type);
  }

  resolve(agentId: string, config: CompiledAgentConfig): AgentRunner | null {
    const engine = config.runner?.engine?.trim();
    const runner =
      (engine ? this.runners.get(engine) : undefined)
      ?? this.runners.get(config.type)
      ?? this.runners.get('default');

    if (!runner) {
      if (config.enabled) {
        throw new Error(
          `Unknown runner for enabled agent '${agentId}' ` +
          `(engine='${engine ?? 'n/a'}', type='${config.type}')`
        );
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
