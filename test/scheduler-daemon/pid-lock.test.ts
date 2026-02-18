import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { IExecutionService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../../src/infra/llm/llm-provider.js';
import type { SchedulerDaemonConfig } from '../../src/scheduler-daemon/daemon.js';

const TEMP_PREFIX = path.join(os.tmpdir(), 'ponybunny-scheduler-');

function createTempConfigDir(): string {
  return fs.mkdtempSync(TEMP_PREFIX);
}

describe('scheduler daemon pid lock', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = createTempConfigDir();
    process.env.PONYBUNNY_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.PONYBUNNY_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('refuses live lock', async () => {
    const { acquireSchedulerDaemonLock } = await import('../../src/scheduler-daemon/pid-lock.js');

    acquireSchedulerDaemonLock();

    await expect(async () => {
      acquireSchedulerDaemonLock();
    }).rejects.toThrow(/already running/i);
  });

  test('replaces stale lock with current pid', async () => {
    const { acquireSchedulerDaemonLock, getSchedulerDaemonLockPath } = await import(
      '../../src/scheduler-daemon/pid-lock.js'
    );

    const lockPath = getSchedulerDaemonLockPath();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: 1 }, null, 2));

    acquireSchedulerDaemonLock();

    const updated = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid: number };
    expect(updated.pid).toBe(process.pid);
  });

  test('removes lock on stop', async () => {
    const { SchedulerDaemon } = await import('../../src/scheduler-daemon/daemon.js');
    const { acquireSchedulerDaemonLock, getSchedulerDaemonLockPath } = await import(
      '../../src/scheduler-daemon/pid-lock.js'
    );

    const repository = {
      initialize: jest.fn(async () => {}),
      close: jest.fn(),
    } as unknown as IWorkOrderRepository;
    const executionService = {} as IExecutionService;
    const llmProvider = {} as ILLMProvider;
    const config: SchedulerDaemonConfig = {
      ipcSocketPath: path.join(configDir, 'gateway.sock'),
      dbPath: path.join(configDir, 'pony.db'),
    };

    const daemon = new SchedulerDaemon(repository, executionService, llmProvider, config);

    acquireSchedulerDaemonLock();
    (daemon as unknown as { hasPidLock: boolean }).hasPidLock = true;
    (daemon as unknown as { isRunning: boolean }).isRunning = true;

    await daemon.stop();

    expect(fs.existsSync(getSchedulerDaemonLockPath())).toBe(false);
  });
});
