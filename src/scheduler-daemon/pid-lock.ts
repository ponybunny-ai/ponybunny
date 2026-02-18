import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir } from '../infra/config/index.js';

export interface SchedulerDaemonLock {
  pid: number;
  startedAt: number;
}

const LOCK_FILE_NAME = 'scheduler-daemon.pid';

export function getSchedulerDaemonLockPath(): string {
  return path.join(getConfigDir(), LOCK_FILE_NAME);
}

function ensureConfigDir(configDir: string): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockFile(lockPath: string): SchedulerDaemonLock | null {
  try {
    if (!fs.existsSync(lockPath)) {
      return null;
    }

    const content = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SchedulerDaemonLock;

    if (!parsed || typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'number') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function acquireSchedulerDaemonLock(): SchedulerDaemonLock {
  const configDir = getConfigDir();
  ensureConfigDir(configDir);

  const lockPath = getSchedulerDaemonLockPath();
  const existing = readLockFile(lockPath);

  if (existing && isProcessRunning(existing.pid)) {
    throw new Error(
      `[SchedulerDaemon] Another scheduler daemon is already running (PID: ${existing.pid}).`
    );
  }

  const lock: SchedulerDaemonLock = {
    pid: process.pid,
    startedAt: Date.now(),
  };

  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  return lock;
}

export function releaseSchedulerDaemonLock(): void {
  const lockPath = getSchedulerDaemonLockPath();
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
  }
}
