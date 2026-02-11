import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface SystemInfo {
  os: OSInfo;
  hardware: HardwareInfo;
  network: NetworkInfo;
  process: ProcessInfo;
}

export interface OSInfo {
  platform: string;
  type: string;
  release: string;
  version: string;
  arch: string;
  hostname: string;
  uptime: number;
}

export interface HardwareInfo {
  cpu: CPUInfo;
  memory: MemoryInfo;
}

export interface CPUInfo {
  model: string;
  cores: number;
  speed: number;
  usage?: number;
}

export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

export interface NetworkInfo {
  interfaces: NetworkInterface[];
}

export interface NetworkInterface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
  mac?: string;
}

export interface ProcessInfo {
  pid: number;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpu: {
    user: number;
    system: number;
  };
}

export interface GatewayProcessInfo extends ProcessInfo {
  type: 'gateway';
  status: 'running' | 'stopped';
  startedAt?: number;
  socketPath?: string;
}

export interface SchedulerProcessInfo extends ProcessInfo {
  type: 'scheduler';
  status: 'running' | 'stopped';
  startedAt?: number;
  dbPath?: string;
  socketPath?: string;
  mode?: 'foreground' | 'background';
}

interface PidFileInfo {
  pid: number;
  startedAt: number;
  dbPath?: string;
  socketPath?: string;
  mode?: 'foreground' | 'background';
}

export function getOSInfo(): OSInfo {
  return {
    platform: os.platform(),
    type: os.type(),
    release: os.release(),
    version: os.version(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptime: os.uptime(),
  };
}

export function getCPUInfo(): CPUInfo {
  const cpus = os.cpus();
  const cpu = cpus[0];

  return {
    model: cpu.model,
    cores: cpus.length,
    speed: cpu.speed,
    usage: calculateCPUUsage(cpus),
  };
}

function calculateCPUUsage(cpus: os.CpuInfo[]): number {
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof os.CpuInfo['times']];
    }
    totalIdle += cpu.times.idle;
  }

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - ~~(100 * idle / total);

  return usage;
}

export function getMemoryInfo(): MemoryInfo {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usagePercent = (used / total) * 100;

  return {
    total,
    free,
    used,
    usagePercent,
  };
}

export function getHardwareInfo(): HardwareInfo {
  return {
    cpu: getCPUInfo(),
    memory: getMemoryInfo(),
  };
}

export function getNetworkInfo(): NetworkInfo {
  const networkInterfaces = os.networkInterfaces();
  const interfaces: NetworkInterface[] = [];

  for (const [name, addrs] of Object.entries(networkInterfaces)) {
    if (!addrs) continue;

    for (const addr of addrs) {
      interfaces.push({
        name,
        address: addr.address,
        family: addr.family as 'IPv4' | 'IPv6',
        internal: addr.internal,
        mac: addr.mac !== '00:00:00:00:00:00' ? addr.mac : undefined,
      });
    }
  }

  return { interfaces };
}

export function getProcessInfo(): ProcessInfo {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  return {
    pid: process.pid,
    uptime: process.uptime(),
    memory: {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
  };
}

export function getSystemInfo(): SystemInfo {
  return {
    os: getOSInfo(),
    hardware: getHardwareInfo(),
    network: getNetworkInfo(),
    process: getProcessInfo(),
  };
}

const PONY_DIR = path.join(homedir(), '.ponybunny');
const GATEWAY_PID_FILE = path.join(PONY_DIR, 'gateway.pid');
const SCHEDULER_PID_FILE = path.join(PONY_DIR, 'scheduler.pid');

function readPidFile(filePath: string): PidFileInfo | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
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

function getProcessStats(pid: number): { memory: number; cpu: number } | null {
  try {
    if (process.platform === 'linux') {
      const statPath = `/proc/${pid}/stat`;
      if (fs.existsSync(statPath)) {
        const stat = fs.readFileSync(statPath, 'utf-8');
        const parts = stat.split(' ');
        const rss = parseInt(parts[23]) * 4096;
        return { memory: rss, cpu: 0 };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function getGatewayProcessInfo(): GatewayProcessInfo {
  const pidInfo = readPidFile(GATEWAY_PID_FILE);

  if (!pidInfo) {
    return {
      type: 'gateway',
      status: 'stopped',
      pid: 0,
      uptime: 0,
      memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
      cpu: { user: 0, system: 0 },
    };
  }

  const isRunning = isProcessRunning(pidInfo.pid);

  if (!isRunning) {
    return {
      type: 'gateway',
      status: 'stopped',
      pid: pidInfo.pid,
      uptime: 0,
      memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
      cpu: { user: 0, system: 0 },
    };
  }

  const stats = getProcessStats(pidInfo.pid);
  const uptime = (Date.now() - pidInfo.startedAt) / 1000;

  return {
    type: 'gateway',
    status: 'running',
    pid: pidInfo.pid,
    startedAt: pidInfo.startedAt,
    socketPath: pidInfo.socketPath,
    uptime,
    memory: stats
      ? { rss: stats.memory, heapTotal: 0, heapUsed: 0, external: 0 }
      : { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
    cpu: { user: 0, system: 0 },
  };
}

export function getSchedulerProcessInfo(): SchedulerProcessInfo {
  const pidInfo = readPidFile(SCHEDULER_PID_FILE);

  if (!pidInfo) {
    return {
      type: 'scheduler',
      status: 'stopped',
      pid: 0,
      uptime: 0,
      memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
      cpu: { user: 0, system: 0 },
    };
  }

  const isRunning = isProcessRunning(pidInfo.pid);

  if (!isRunning) {
    return {
      type: 'scheduler',
      status: 'stopped',
      pid: pidInfo.pid,
      uptime: 0,
      memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
      cpu: { user: 0, system: 0 },
    };
  }

  const stats = getProcessStats(pidInfo.pid);
  const uptime = (Date.now() - pidInfo.startedAt) / 1000;

  return {
    type: 'scheduler',
    status: 'running',
    pid: pidInfo.pid,
    startedAt: pidInfo.startedAt,
    dbPath: pidInfo.dbPath,
    socketPath: pidInfo.socketPath,
    mode: pidInfo.mode,
    uptime,
    memory: stats
      ? { rss: stats.memory, heapTotal: 0, heapUsed: 0, external: 0 }
      : { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
    cpu: { user: 0, system: 0 },
  };
}

export function getAllProcessInfo(): {
  current: ProcessInfo;
  gateway: GatewayProcessInfo;
  scheduler: SchedulerProcessInfo;
} {
  return {
    current: getProcessInfo(),
    gateway: getGatewayProcessInfo(),
    scheduler: getSchedulerProcessInfo(),
  };
}
