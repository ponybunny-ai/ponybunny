import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '../config/config-paths.js';

export interface ResolveAgentWorkdirParams {
  agentId: string;
  configuredWorkdir?: string;
  configPath?: string;
}

export function resolveAgentWorkdir(params: ResolveAgentWorkdirParams): string {
  const configured = params.configuredWorkdir?.trim();
  if (configured && configured.length > 0) {
    if (path.isAbsolute(configured)) {
      return path.resolve(configured);
    }

    if (params.configPath) {
      return path.resolve(path.dirname(params.configPath), configured);
    }

    return path.resolve(process.cwd(), configured);
  }

  return path.resolve(getConfigDir(), 'workdirs', params.agentId);
}

export function ensureAgentWorkdir(params: ResolveAgentWorkdirParams): string {
  const workdir = resolveAgentWorkdir(params);
  fs.mkdirSync(workdir, { recursive: true, mode: 0o700 });
  return workdir;
}
