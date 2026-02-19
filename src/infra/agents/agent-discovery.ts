import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getConfigDir } from '../config/credentials-loader.js';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const realpath = promisify(fs.realpath);

export type AgentConfigSource = 'workspace' | 'user';

export interface AgentDiscoveryCandidate {
  id: string;
  source: AgentConfigSource;
  agentDir: string;
  agentDirRealPath: string;
  agentConfigPath: string;
  agentConfigRealPath: string;
  agentMarkdownPath: string;
  agentMarkdownRealPath: string;
  configId: string | null;
  idMatches: boolean;
  configParseError?: string;
}

export interface AgentDiscoveryOptions {
  workspaceDir: string;
  userDir?: string;
  logger?: Pick<Console, 'info'>;
}

const SOURCE_RANK: Record<AgentConfigSource, number> = {
  workspace: 0,
  user: 1,
};

function shouldReplaceCandidate(
  existing: AgentDiscoveryCandidate,
  incoming: AgentDiscoveryCandidate
): boolean {
  const rankDiff = SOURCE_RANK[incoming.source] - SOURCE_RANK[existing.source];
  if (rankDiff !== 0) {
    return rankDiff > 0;
  }

  if (incoming.idMatches !== existing.idMatches) {
    return incoming.idMatches;
  }

  return false;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const dirStat = await stat(dirPath);
    return dirStat.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function readAgentConfigId(
  configPath: string,
  expectedId: string
): Promise<{ configId: string | null; idMatches: boolean; configParseError?: string }> {
  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as { id?: unknown };
    const configId = typeof parsed.id === 'string' ? parsed.id : null;
    return { configId, idMatches: configId === expectedId };
  } catch (error) {
    return {
      configId: null,
      idMatches: false,
      configParseError: (error as Error).message,
    };
  }
}

async function discoverAgentsFromDir(
  dir: string,
  source: AgentConfigSource,
  logger: Pick<Console, 'info'>
): Promise<AgentDiscoveryCandidate[]> {
  if (!(await isDirectory(dir))) {
    return [];
  }

  const entries = (await readdir(dir)).slice().sort();
  const candidates: AgentDiscoveryCandidate[] = [];

  for (const entry of entries) {
    const agentDir = path.join(dir, entry);
    if (!(await isDirectory(agentDir))) {
      continue;
    }

    const agentConfigPath = path.join(agentDir, 'agent.json');
    const agentMarkdownPath = path.join(agentDir, 'AGENT.md');

    if (!(await isFile(agentConfigPath)) || !(await isFile(agentMarkdownPath))) {
      continue;
    }

    const [agentDirRealPath, agentConfigRealPath, agentMarkdownRealPath] = await Promise.all([
      realpath(agentDir),
      realpath(agentConfigPath),
      realpath(agentMarkdownPath),
    ]);

    const { configId, idMatches, configParseError } = await readAgentConfigId(
      agentConfigPath,
      entry
    );

    const candidate: AgentDiscoveryCandidate = {
      id: entry,
      source,
      agentDir,
      agentDirRealPath,
      agentConfigPath,
      agentConfigRealPath,
      agentMarkdownPath,
      agentMarkdownRealPath,
      configId,
      idMatches,
      ...(configParseError ? { configParseError } : {}),
    };

    logger.info('[AgentDiscovery] Candidate discovered', {
      agentId: candidate.id,
      source: candidate.source,
      idMatches: candidate.idMatches,
      configId: candidate.configId,
    });

    candidates.push(candidate);
  }

  return candidates;
}

export function getWorkspaceAgentsDir(workspaceDir: string): string {
  return path.join(workspaceDir, 'agents');
}

export function getUserAgentsDir(configDir: string = getConfigDir()): string {
  return path.join(configDir, 'agents');
}

export async function discoverAgentCandidates(
  options: AgentDiscoveryOptions
): Promise<AgentDiscoveryCandidate[]> {
  const logger = options.logger ?? console;
  const workspaceAgentsDir = getWorkspaceAgentsDir(options.workspaceDir);
  const userAgentsDir = options.userDir ?? getUserAgentsDir();

  const [workspaceCandidates, userCandidates] = await Promise.all([
    discoverAgentsFromDir(workspaceAgentsDir, 'workspace', logger),
    discoverAgentsFromDir(userAgentsDir, 'user', logger),
  ]);

  const byId = new Map<string, AgentDiscoveryCandidate>();
  const byRealPath = new Map<string, AgentDiscoveryCandidate>();

  const applyCandidate = (candidate: AgentDiscoveryCandidate): void => {
    const existingReal = byRealPath.get(candidate.agentDirRealPath);
    if (existingReal && !shouldReplaceCandidate(existingReal, candidate)) {
      return;
    }

    if (existingReal) {
      byId.delete(existingReal.id);
    }

    const existingId = byId.get(candidate.id);
    if (existingId && !shouldReplaceCandidate(existingId, candidate)) {
      return;
    }

    if (existingId) {
      logger.info('[AgentDiscovery] Applying precedence override', {
        agentId: candidate.id,
        winnerSource: candidate.source,
        loserSource: existingId.source,
      });
      byRealPath.delete(existingId.agentDirRealPath);
    }

    byId.set(candidate.id, candidate);
    byRealPath.set(candidate.agentDirRealPath, candidate);
  };

  const sortedWorkspace = workspaceCandidates
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const sortedUser = userCandidates.slice().sort((a, b) => a.id.localeCompare(b.id));

  for (const candidate of sortedWorkspace) {
    applyCandidate(candidate);
  }

  for (const candidate of sortedUser) {
    applyCandidate(candidate);
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
