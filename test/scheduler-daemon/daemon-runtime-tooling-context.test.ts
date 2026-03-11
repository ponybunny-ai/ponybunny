import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeToolingContext } from '../../src/runtime/tooling-context/index.js';
import type { IExecutionService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../../src/infra/llm/llm-provider.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import { SchedulerDaemon } from '../../src/scheduler-daemon/daemon.js';

function createRuntimeToolingContextStub(): RuntimeToolingContext {
  return {
    toolProvider: {
      getToolDefinitions: () => [],
      getToolsForPhase: () => [],
    },
    getPromptProvider: () => ({
      generatePrompt: () => '',
    }),
  } as unknown as RuntimeToolingContext;
}

describe('SchedulerDaemon runtime tooling context threading', () => {
  it('threads the explicit runtime tooling context from daemon config into session intake', () => {
    const repository = {} as IWorkOrderRepository;
    const executionService = {
      getRuntimeToolingContext: () => {
        throw new Error('SchedulerDaemon should not recover runtime tooling context from ExecutionService');
      },
    } as unknown as IExecutionService;
    const llmProvider = {} as ILLMProvider;
    const runtimeToolingContext = createRuntimeToolingContextStub();
    const memoryDb = new Database(':memory:');

    try {
      const daemon = new SchedulerDaemon(repository, executionService, llmProvider, {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        memoryDb,
        runtimeToolingContext,
      });

      const sessionIntake = (daemon as unknown as {
        createSessionIntake: () => { deps: { runtimeToolingContext: RuntimeToolingContext } } | null;
      }).createSessionIntake();

      expect(sessionIntake).not.toBeNull();
      expect(sessionIntake?.deps.runtimeToolingContext).toBe(runtimeToolingContext);
    } finally {
      memoryDb.close();
    }
  });

  it('does not allow the migrated session-intake path to fall back when runtime tooling context is omitted', () => {
    const repository = {} as IWorkOrderRepository;
    const executionService = {
      getRuntimeToolingContext: () => {
        throw new Error('SchedulerDaemon should not recover runtime tooling context from ExecutionService');
      },
    } as unknown as IExecutionService;
    const llmProvider = {} as ILLMProvider;
    const memoryDb = new Database(':memory:');

    try {
      const daemon = new SchedulerDaemon(repository, executionService, llmProvider, {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        memoryDb,
      } as never);

      expect(() => {
        (daemon as unknown as {
          createSessionIntake: () => unknown;
        }).createSessionIntake();
      }).toThrow('[SchedulerDaemon] Session intake requires an explicit RuntimeToolingContext');
    } finally {
      memoryDb.close();
    }
  });
});
