import os from 'os';
import type { DeviceFingerprint } from './account-types.js';
import { ANTIGRAVITY_VERSION } from './antigravity-constants.js';

const PLATFORM_CHOICES = ['darwin', 'windows', 'linux'] as const;
const ARCH_CHOICES = ['x64', 'arm64'] as const;

type PlatformChoice = typeof PLATFORM_CHOICES[number];
type ArchChoice = typeof ARCH_CHOICES[number];

function randomFrom<T>(choices: readonly T[]): T {
  return choices[Math.floor(Math.random() * choices.length)]!;
}

function normalizePlatform(platform: string): PlatformChoice {
  switch (platform) {
    case 'win32':
    case 'windows':
      return 'windows';
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      return 'linux';
  }
}

function normalizeArch(arch: string): ArchChoice {
  switch (arch) {
    case 'arm64':
      return 'arm64';
    case 'x64':
    default:
      return 'x64';
  }
}

function toUserAgentArch(arch: ArchChoice): string {
  return arch === 'x64' ? 'amd64' : 'arm64';
}

export function buildUserAgent(platform: string, arch: string): string {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);
  return `antigravity/${ANTIGRAVITY_VERSION} ${normalizedPlatform}/${toUserAgentArch(normalizedArch)}`;
}

export function generateDeviceFingerprint(options?: { randomize?: boolean }): DeviceFingerprint {
  const randomize = options?.randomize !== false;
  const platform = randomize ? randomFrom(PLATFORM_CHOICES) : normalizePlatform(os.platform());
  const arch = randomize ? randomFrom(ARCH_CHOICES) : normalizeArch(os.arch());

  return {
    userAgent: buildUserAgent(platform, arch),
    platform,
    arch,
    nodeVersion: process.version,
  };
}

let sessionFingerprint: DeviceFingerprint | null = null;

export function getSessionFingerprint(): DeviceFingerprint {
  if (!sessionFingerprint) {
    sessionFingerprint = generateDeviceFingerprint();
  }
  return sessionFingerprint;
}

export function regenerateSessionFingerprint(): DeviceFingerprint {
  sessionFingerprint = generateDeviceFingerprint();
  return sessionFingerprint;
}
