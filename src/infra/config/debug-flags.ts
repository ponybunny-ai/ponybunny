import { loadRuntimeConfig } from './runtime-config.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isTruthy(value: string | undefined): boolean {
  return typeof value === 'string' && TRUE_VALUES.has(value.trim().toLowerCase());
}

export function isPonyBunnyDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PONY_BUNNY_DEBUG !== undefined) {
    return env.PONY_BUNNY_DEBUG === '1';
  }

  return loadRuntimeConfig().debug.loggingEnabled;
}

export function isLegacyDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.DEBUG_MODE) || env.PB_DEBUG === '1';
}

export function isDebugLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isPonyBunnyDebugEnabled(env) || isLegacyDebugEnabled(env);
}

export function isAntigravityDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PB_ANTIGRAVITY_DEBUG !== undefined) {
    return env.PB_ANTIGRAVITY_DEBUG === '1' || isDebugLoggingEnabled(env);
  }

  return loadRuntimeConfig().debug.antigravityDebug || isDebugLoggingEnabled(env);
}
