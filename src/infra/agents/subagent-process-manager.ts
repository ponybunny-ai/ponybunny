import path from 'node:path';
import fs from 'node:fs';
import { fork, type ChildProcess } from 'node:child_process';
import type {
  SubagentChildMessage,
  SubagentInitPayload,
  SubagentParentMessage,
} from './subagent-protocol.js';

export interface SubagentProcessTarget {
  subagentId: string;
  workdir: string;
}

export interface SubagentExecutionContext {
  agentId: string;
  runKey: string;
  goalId?: string;
  targets: SubagentProcessTarget[];
}

export interface StartedSubagentProcess {
  subagentId: string;
  pid: number;
  child: ChildProcess;
}

export interface SubagentHeartbeatSnapshot {
  subagentId: string;
  pid: number;
  lastHeartbeatAtMs: number;
  stale: boolean;
}

export interface SubagentProcessManager {
  startSubagents(context: SubagentExecutionContext): Promise<StartedSubagentProcess[]>;
  stopSubagents(processes: StartedSubagentProcess[]): Promise<void>;
  getHeartbeatSnapshot(processes: StartedSubagentProcess[]): SubagentHeartbeatSnapshot[];
}

const SUBAGENT_TERM_TIMEOUT_MS = 3000;
const SUBAGENT_READY_TIMEOUT_MS = 3000;
const SUBAGENT_SHUTDOWN_TIMEOUT_MS = 2000;
const SUBAGENT_HEARTBEAT_STALE_MS = 5000;
const SUBAGENT_HEARTBEAT_CHECK_MS = 1000;

export interface ProcessSubagentManagerOptions {
  heartbeatStaleMs?: number;
  heartbeatCheckMs?: number;
}

interface TrackedHeartbeatState {
  subagentId: string;
  parentAgentId: string;
  lastHeartbeatAtMs: number;
  stale: boolean;
  onMessage: (message: unknown) => void;
  monitorTimer: NodeJS.Timeout;
}

const resolveSubagentWorkerModule = (): string => {
  const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
  const entryDir = entryPoint ? path.dirname(entryPoint) : undefined;

  const entryCandidates = entryDir
    ? [
        path.join(entryDir, 'subagent-worker.js'),
        path.join(entryDir, 'infra', 'agents', 'subagent-worker.js'),
        path.join(entryDir, '..', 'infra', 'agents', 'subagent-worker.js'),
      ]
    : [];

  const candidates = [
    path.join(process.cwd(), 'dist', 'infra', 'agents', 'subagent-worker.js'),
    path.join(process.cwd(), 'src', 'infra', 'agents', 'subagent-worker.js'),
    ...entryCandidates,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
};

const SUBAGENT_WORKER_MODULE = resolveSubagentWorkerModule();

const maybeUnref = (handle: NodeJS.Timeout): void => {
  if (typeof handle.unref === 'function') {
    handle.unref();
  }
};

const terminateProcess = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const cleanup = (): void => {
      settled = true;
      clearTimeout(fallbackTimer);
      resolve();
    };

    child.once('exit', cleanup);

    const fallbackTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      try {
        child.kill('SIGKILL');
      } catch {}
      cleanup();
    }, SUBAGENT_TERM_TIMEOUT_MS);
    maybeUnref(fallbackTimer);

    try {
      child.kill('SIGTERM');
    } catch {
      cleanup();
    }
  });
};

const waitForReady = async (child: ChildProcess): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for subagent ready signal'));
    }, SUBAGENT_READY_TIMEOUT_MS);
    maybeUnref(timeout);

    const onMessage = (message: unknown): void => {
      const typed = message as SubagentChildMessage;
      if (typed?.type === 'ready') {
        cleanup();
        resolve();
      }
    };

    const onExit = (): void => {
      cleanup();
      reject(new Error('Subagent process exited before ready signal'));
    };

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
    };

    child.on('message', onMessage);
    child.on('exit', onExit);
  });
};

const requestShutdown = async (child: ChildProcess): Promise<boolean> => {
  if (child.exitCode !== null || child.killed) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, SUBAGENT_SHUTDOWN_TIMEOUT_MS);
    maybeUnref(timeout);

    const onMessage = (message: unknown): void => {
      const typed = message as SubagentChildMessage;
      if (typed?.type === 'shutdown_ack') {
        cleanup();
        resolve(true);
      }
    };

    const onExit = (): void => {
      cleanup();
      resolve(true);
    };

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
    };

    child.on('message', onMessage);
    child.on('exit', onExit);

    const shutdownMessage: SubagentParentMessage = { type: 'shutdown' };
    child.send(shutdownMessage);
  });
};

export class ProcessSubagentManager implements SubagentProcessManager {
  private readonly heartbeatStaleMs: number;
  private readonly heartbeatCheckMs: number;
  private readonly heartbeatByPid = new Map<number, TrackedHeartbeatState>();

  constructor(
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
    options: ProcessSubagentManagerOptions = {}
  ) {
    this.heartbeatStaleMs = options.heartbeatStaleMs ?? SUBAGENT_HEARTBEAT_STALE_MS;
    this.heartbeatCheckMs = options.heartbeatCheckMs ?? SUBAGENT_HEARTBEAT_CHECK_MS;
  }

  getHeartbeatSnapshot(processes: StartedSubagentProcess[]): SubagentHeartbeatSnapshot[] {
    return processes.map((processInfo) => {
      const tracked = this.heartbeatByPid.get(processInfo.pid);
      return {
        subagentId: processInfo.subagentId,
        pid: processInfo.pid,
        lastHeartbeatAtMs: tracked?.lastHeartbeatAtMs ?? 0,
        stale: tracked?.stale ?? false,
      };
    });
  }

  private attachHeartbeatTracking(
    child: ChildProcess,
    subagentId: string,
    parentAgentId: string
  ): void {
    if (typeof child.pid !== 'number') {
      return;
    }

    const state: TrackedHeartbeatState = {
      subagentId,
      parentAgentId,
      lastHeartbeatAtMs: Date.now(),
      stale: false,
      onMessage: () => {},
      monitorTimer: setInterval(() => {}, this.heartbeatCheckMs),
    };

    state.onMessage = (message: unknown): void => {
      const typed = message as SubagentChildMessage;
      if (typed?.type !== 'heartbeat') {
        return;
      }
      if (typed.payload.subagentId !== subagentId) {
        return;
      }
      state.lastHeartbeatAtMs = typed.payload.timestamp;
      state.stale = false;
    };

    state.monitorTimer = setInterval(() => {
      if (child.exitCode !== null || child.killed) {
        this.detachHeartbeatTracking(child);
        return;
      }

      const age = Date.now() - state.lastHeartbeatAtMs;
      if (age <= this.heartbeatStaleMs || state.stale) {
        return;
      }

      state.stale = true;
      this.logger.warn('[SubagentProcessManager] Subagent heartbeat stale; terminating process', {
        subagentId,
        pid: child.pid,
        parentAgentId,
        heartbeatAgeMs: age,
      });

      void terminateProcess(child).finally(() => {
        this.detachHeartbeatTracking(child);
      });
    }, this.heartbeatCheckMs);
    maybeUnref(state.monitorTimer);

    child.on('message', state.onMessage);
    child.once('exit', () => {
      this.detachHeartbeatTracking(child);
    });

    this.heartbeatByPid.set(child.pid, state);
  }

  private detachHeartbeatTracking(child: ChildProcess): void {
    if (typeof child.pid !== 'number') {
      return;
    }
    const state = this.heartbeatByPid.get(child.pid);
    if (!state) {
      return;
    }

    clearInterval(state.monitorTimer);
    child.off('message', state.onMessage);
    this.heartbeatByPid.delete(child.pid);
  }

  async startSubagents(context: SubagentExecutionContext): Promise<StartedSubagentProcess[]> {
    if (context.targets.length === 0) {
      return [];
    }

    const started: StartedSubagentProcess[] = [];

    for (const target of context.targets) {
      const { subagentId, workdir } = target;
      const child = fork(SUBAGENT_WORKER_MODULE, [], {
        cwd: workdir,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {
          ...process.env,
          PONY_SUBAGENT_MODE: '1',
          PONY_PARENT_AGENT_ID: context.agentId,
          PONY_SUBAGENT_ID: subagentId,
          PONY_RUN_KEY: context.runKey,
          ...(context.goalId ? { PONY_GOAL_ID: context.goalId } : {}),
        },
      });

      if (typeof child.pid !== 'number') {
        await this.stopSubagents(started);
        throw new Error(`Failed to spawn subagent process: ${subagentId}`);
      }

      const initPayload: SubagentInitPayload = {
        parentAgentId: context.agentId,
        subagentId,
        runKey: context.runKey,
        goalId: context.goalId,
      };
      const initMessage: SubagentParentMessage = { type: 'init', payload: initPayload };
      const readyPromise = waitForReady(child);
      child.send(initMessage);

      await readyPromise;
      this.attachHeartbeatTracking(child, subagentId, context.agentId);

      started.push({
        subagentId,
        pid: child.pid,
        child,
      });

      this.logger.info('[SubagentProcessManager] Spawned subagent process', {
        subagentId,
        pid: child.pid,
        parentAgentId: context.agentId,
      });
    }

    return started;
  }

  async stopSubagents(processes: StartedSubagentProcess[]): Promise<void> {
    for (const processInfo of processes) {
      const graceful = await requestShutdown(processInfo.child);
      if (!graceful) {
        await terminateProcess(processInfo.child);
      }
      this.detachHeartbeatTracking(processInfo.child);
      this.logger.info('[SubagentProcessManager] Stopped subagent process', {
        subagentId: processInfo.subagentId,
        pid: processInfo.pid,
      });
    }
  }
}
