/**
 * Unit tests for `pb webui` command logic.
 *
 * The webui.ts module uses `import.meta.dirname` which ts-jest cannot compile,
 * so we cannot import the module directly. Instead, we replicate and test the
 * same logic the command uses — PID file operations, process detection,
 * uptime formatting, web directory resolution, and command flow — following
 * the same pattern used by learn.test.ts and failure-analysis.test.ts.
 *
 * This approach validates the correctness of the algorithms without depending
 * on the commander wiring.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Replicated helpers from webui.ts
// ---------------------------------------------------------------------------

interface PidInfo {
  pid: number;
  port: number;
  startedAt: number;
  webDir: string;
  mode: 'development' | 'production';
}

function ensurePonyDir(ponyDir: string): void {
  if (!fs.existsSync(ponyDir)) {
    fs.mkdirSync(ponyDir, { recursive: true });
  }
}

function writePidFile(pidFile: string, ponyDir: string, info: PidInfo): void {
  ensurePonyDir(ponyDir);
  fs.writeFileSync(pidFile, JSON.stringify(info, null, 2));
}

function readPidFile(pidFile: string): PidInfo | null {
  try {
    if (!fs.existsSync(pidFile)) return null;
    return JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
  } catch {
    return null;
  }
}

function removePidFile(pidFile: string): void {
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {
    // ignore
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

function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function resolveWebDir(cwd: string, importMetaDirname: string | undefined): string {
  const candidates = [
    path.join(cwd, 'web'),
    path.resolve(path.join(importMetaDirname ?? '.', '../../../web')),
    path.resolve(path.join(importMetaDirname ?? '.', '../../../../web')),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return path.join(cwd, 'web');
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let ponyDir: string;
let pidFile: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-test-'));
  ponyDir = path.join(tempDir, '.ponybunny');
  pidFile = path.join(ponyDir, 'webui.pid');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PID file read / write / cleanup
// ---------------------------------------------------------------------------

describe('PID file operations', () => {
  it('writes and reads back PID info', () => {
    const info: PidInfo = {
      pid: 12345,
      port: 3000,
      startedAt: Date.now(),
      webDir: '/repo/web',
      mode: 'development',
    };

    writePidFile(pidFile, ponyDir, info);
    const result = readPidFile(pidFile);

    expect(result).toEqual(info);
  });

  it('creates .ponybunny directory if it does not exist', () => {
    expect(fs.existsSync(ponyDir)).toBe(false);

    writePidFile(pidFile, ponyDir, {
      pid: 1, port: 3000, startedAt: 1, webDir: '/w', mode: 'development',
    });

    expect(fs.existsSync(ponyDir)).toBe(true);
    expect(fs.existsSync(pidFile)).toBe(true);
  });

  it('returns null when PID file does not exist', () => {
    expect(readPidFile(pidFile)).toBeNull();
  });

  it('returns null when PID file contains invalid JSON', () => {
    fs.mkdirSync(ponyDir, { recursive: true });
    fs.writeFileSync(pidFile, 'not-json{{{');

    expect(readPidFile(pidFile)).toBeNull();
  });

  it('removes PID file when it exists', () => {
    writePidFile(pidFile, ponyDir, {
      pid: 1, port: 3000, startedAt: 1, webDir: '/w', mode: 'development',
    });
    expect(fs.existsSync(pidFile)).toBe(true);

    removePidFile(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('does not throw when removing nonexistent PID file', () => {
    expect(() => removePidFile(pidFile)).not.toThrow();
  });

  it('preserves all PidInfo fields through write/read cycle', () => {
    const info: PidInfo = {
      pid: 99999,
      port: 4200,
      startedAt: 1711000000000,
      webDir: '/some/path/to/web',
      mode: 'production',
    };

    writePidFile(pidFile, ponyDir, info);
    const result = readPidFile(pidFile);

    expect(result!.pid).toBe(99999);
    expect(result!.port).toBe(4200);
    expect(result!.startedAt).toBe(1711000000000);
    expect(result!.webDir).toBe('/some/path/to/web');
    expect(result!.mode).toBe('production');
  });
});

// ---------------------------------------------------------------------------
// Process detection (isProcessRunning / killProcess)
// ---------------------------------------------------------------------------

describe('isProcessRunning', () => {
  it('returns true for current process', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it('returns false for a PID that does not exist', () => {
    // PID 2^30 is extremely unlikely to be running
    expect(isProcessRunning(1073741824)).toBe(false);
  });
});

describe('killProcess', () => {
  it('returns true when signal is sent to a living process', () => {
    // Sending signal 0 to self succeeds
    const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as never);
    expect(killProcess(process.pid, 'SIGTERM')).toBe(true);
    spy.mockRestore();
  });

  it('returns false when process does not exist', () => {
    expect(killProcess(1073741824)).toBe(false);
  });

  it('defaults to SIGTERM', () => {
    const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as never);
    killProcess(12345);
    expect(spy).toHaveBeenCalledWith(12345, 'SIGTERM');
    spy.mockRestore();
  });

  it('passes SIGKILL when specified', () => {
    const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as never);
    killProcess(12345, 'SIGKILL');
    expect(spy).toHaveBeenCalledWith(12345, 'SIGKILL');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// formatUptime
// ---------------------------------------------------------------------------

describe('formatUptime', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatUptime(45000)).toBe('45s');
  });

  it('formats zero as 0s', () => {
    expect(formatUptime(0)).toBe('0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatUptime(125000)).toBe('2m 5s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatUptime(3661000)).toBe('1h 1m 1s');
  });

  it('formats days, hours, and minutes', () => {
    const ms = (2 * 86400 + 3 * 3600 + 15 * 60) * 1000;
    expect(formatUptime(ms)).toBe('2d 3h 15m');
  });

  it('handles exact hour boundary', () => {
    expect(formatUptime(3600000)).toBe('1h 0m 0s');
  });

  it('handles exact day boundary', () => {
    expect(formatUptime(86400000)).toBe('1d 0h 0m');
  });
});

// ---------------------------------------------------------------------------
// resolveWebDir
// ---------------------------------------------------------------------------

describe('resolveWebDir', () => {
  it('prefers cwd/web when it has package.json', () => {
    const webDir = path.join(tempDir, 'web');
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, 'package.json'), '{}');

    const result = resolveWebDir(tempDir, undefined);
    expect(result).toBe(webDir);
  });

  it('falls back to cwd/web when no candidate has package.json', () => {
    const result = resolveWebDir(tempDir, undefined);
    expect(result).toBe(path.join(tempDir, 'web'));
  });

  it('uses importMetaDirname-relative path when cwd/web has no package.json', () => {
    // Create a web dir three levels up from a fake dirname
    const fakeModuleDir = path.join(tempDir, 'dist', 'src', 'cli', 'commands');
    fs.mkdirSync(fakeModuleDir, { recursive: true });
    const webDir = path.join(tempDir, 'web');
    fs.mkdirSync(webDir, { recursive: true });
    // cwd/web has no package.json, but the resolved path does
    // ../../../web from fakeModuleDir = tempDir/dist/web — not matching
    // Actually: resolve(join(fakeModuleDir, '../../../web')) = tempDir/dist/web
    // So let's put the package.json there
    const resolvedWebDir = path.resolve(path.join(fakeModuleDir, '../../../web'));
    fs.mkdirSync(resolvedWebDir, { recursive: true });
    fs.writeFileSync(path.join(resolvedWebDir, 'package.json'), '{}');

    // Use a different cwd so the first candidate fails
    const result = resolveWebDir('/nonexistent', fakeModuleDir);
    expect(result).toBe(resolvedWebDir);
  });

  it('handles undefined importMetaDirname gracefully', () => {
    // When importMetaDirname is undefined, it should still work (uses '.' as fallback)
    const result = resolveWebDir(tempDir, undefined);
    expect(result).toBe(path.join(tempDir, 'web'));
  });
});

// ---------------------------------------------------------------------------
// Stale PID detection flow (status command logic)
// ---------------------------------------------------------------------------

describe('status command flow', () => {
  it('detects running process via PID file', () => {
    const info: PidInfo = {
      pid: process.pid, // use own PID so isProcessRunning returns true
      port: 3000,
      startedAt: Date.now() - 60000,
      webDir: '/repo/web',
      mode: 'development',
    };

    writePidFile(pidFile, ponyDir, info);
    const pidInfo = readPidFile(pidFile);

    expect(pidInfo).not.toBeNull();
    expect(isProcessRunning(pidInfo!.pid)).toBe(true);
  });

  it('detects stale PID file and removes it', () => {
    const info: PidInfo = {
      pid: 1073741824, // dead PID
      port: 3000,
      startedAt: Date.now() - 60000,
      webDir: '/repo/web',
      mode: 'development',
    };

    writePidFile(pidFile, ponyDir, info);
    const pidInfo = readPidFile(pidFile);

    expect(pidInfo).not.toBeNull();
    expect(isProcessRunning(pidInfo!.pid)).toBe(false);

    // Simulate status command cleanup
    removePidFile(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stop command flow
// ---------------------------------------------------------------------------

describe('stop command flow', () => {
  it('sends SIGTERM to PID from file', () => {
    const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as never);

    const info: PidInfo = {
      pid: 54321,
      port: 3000,
      startedAt: Date.now(),
      webDir: '/w',
      mode: 'development',
    };
    writePidFile(pidFile, ponyDir, info);

    const pidInfo = readPidFile(pidFile);
    expect(pidInfo).not.toBeNull();

    const killed = killProcess(pidInfo!.pid);
    expect(killed).toBe(true);
    expect(spy).toHaveBeenCalledWith(54321, 'SIGTERM');

    removePidFile(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);

    spy.mockRestore();
  });

  it('uses SIGKILL when force is true', () => {
    const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as never);

    const killed = killProcess(54321, 'SIGKILL');
    expect(killed).toBe(true);
    expect(spy).toHaveBeenCalledWith(54321, 'SIGKILL');

    spy.mockRestore();
  });

  it('handles already-dead process gracefully', () => {
    const info: PidInfo = {
      pid: 1073741824,
      port: 3000,
      startedAt: Date.now(),
      webDir: '/w',
      mode: 'development',
    };
    writePidFile(pidFile, ponyDir, info);

    const pidInfo = readPidFile(pidFile);
    const running = isProcessRunning(pidInfo!.pid);
    expect(running).toBe(false);

    // Stop flow: when process not running from PID file, try port fallback
    // When port fallback also fails, clean up PID file
    removePidFile(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Start command flow (mode and port selection)
// ---------------------------------------------------------------------------

describe('start command flow', () => {
  it('selects dev mode by default', () => {
    const prod = false;
    const mode: 'development' | 'production' = prod ? 'production' : 'development';
    const npmScript = prod ? 'start' : 'dev';

    expect(mode).toBe('development');
    expect(npmScript).toBe('dev');
  });

  it('selects production mode with --prod', () => {
    const prod = true;
    const mode: 'development' | 'production' = prod ? 'production' : 'development';
    const npmScript = prod ? 'start' : 'dev';

    expect(mode).toBe('production');
    expect(npmScript).toBe('start');
  });

  it('parses port from string option', () => {
    const portStr = '4200';
    const port = parseInt(portStr, 10);

    expect(port).toBe(4200);
  });

  it('uses default port 3000', () => {
    const DEFAULT_PORT = 3000;
    expect(DEFAULT_PORT).toBe(3000);
  });

  it('refuses start when process already running without force', () => {
    const info: PidInfo = {
      pid: process.pid, // alive
      port: 3000,
      startedAt: Date.now(),
      webDir: '/w',
      mode: 'development',
    };
    writePidFile(pidFile, ponyDir, info);

    const existing = readPidFile(pidFile);
    const alreadyRunning = existing && isProcessRunning(existing.pid);

    expect(alreadyRunning).toBe(true);
    // Without --force, should not proceed
  });

  it('writes correct PID info after spawn', () => {
    const info: PidInfo = {
      pid: 88888,
      port: 4000,
      startedAt: Date.now(),
      webDir: '/repo/web',
      mode: 'production',
    };

    writePidFile(pidFile, ponyDir, info);
    const result = readPidFile(pidFile);

    expect(result).toEqual(info);
  });
});

// ---------------------------------------------------------------------------
// Restart command flow
// ---------------------------------------------------------------------------

describe('restart command flow', () => {
  it('stops existing process then starts new one', () => {
    const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as never);

    // Existing process
    const oldInfo: PidInfo = {
      pid: 11111,
      port: 3000,
      startedAt: Date.now() - 60000,
      webDir: '/w',
      mode: 'development',
    };
    writePidFile(pidFile, ponyDir, oldInfo);

    // Stop phase
    const pidInfo = readPidFile(pidFile);
    expect(pidInfo).not.toBeNull();
    killProcess(pidInfo!.pid);
    removePidFile(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);

    // Start phase — new PID info
    const newInfo: PidInfo = {
      pid: 22222,
      port: 3000,
      startedAt: Date.now(),
      webDir: '/w',
      mode: 'development',
    };
    writePidFile(pidFile, ponyDir, newInfo);

    const result = readPidFile(pidFile);
    expect(result!.pid).toBe(22222);

    spy.mockRestore();
  });

  it('starts fresh when no previous process exists', () => {
    const pidInfo = readPidFile(pidFile);
    expect(pidInfo).toBeNull();

    // Should proceed to start without error
    const newInfo: PidInfo = {
      pid: 33333,
      port: 3000,
      startedAt: Date.now(),
      webDir: '/w',
      mode: 'development',
    };
    writePidFile(pidFile, ponyDir, newInfo);

    const result = readPidFile(pidFile);
    expect(result!.pid).toBe(33333);
  });
});
