import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverAgentCandidates } from '../../../src/infra/agents/agent-discovery.js';

const ORIGINAL_CONFIG_DIR = process.env.PONYBUNNY_CONFIG_DIR;

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agent-discovery-'));
}

function writeAgentDir(baseDir: string, id: string, configId: string = id): string {
  const agentDir = path.join(baseDir, id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), '# Agent\n', 'utf-8');
  fs.writeFileSync(
    path.join(agentDir, 'agent.json'),
    JSON.stringify({ id: configId }, null, 2),
    'utf-8'
  );
  return agentDir;
}

describe('Agent discovery', () => {
  afterEach(() => {
    if (ORIGINAL_CONFIG_DIR === undefined) {
      delete process.env.PONYBUNNY_CONFIG_DIR;
    } else {
      process.env.PONYBUNNY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
    }
    jest.restoreAllMocks();
  });

  it('discovers workspace agents', async () => {
    const workspaceDir = createTempDir();
    const agentsDir = path.join(workspaceDir, 'agents');
    const agentDir = writeAgentDir(agentsDir, 'alpha');

    process.env.PONYBUNNY_CONFIG_DIR = createTempDir();

    const candidates = await discoverAgentCandidates({ workspaceDir });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'alpha',
      source: 'workspace',
      configId: 'alpha',
      idMatches: true,
      agentDir,
    });
  });

  it('discovers user agents', async () => {
    const workspaceDir = createTempDir();
    const configDir = createTempDir();
    const userAgentsDir = path.join(configDir, 'agents');
    const agentDir = writeAgentDir(userAgentsDir, 'beta');

    process.env.PONYBUNNY_CONFIG_DIR = configDir;

    const candidates = await discoverAgentCandidates({ workspaceDir });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'beta',
      source: 'user',
      configId: 'beta',
      idMatches: true,
      agentDir,
    });
  });

  it('prefers user agent over workspace with same id', async () => {
    const workspaceDir = createTempDir();
    const workspaceAgentsDir = path.join(workspaceDir, 'agents');
    writeAgentDir(workspaceAgentsDir, 'alpha');

    const configDir = createTempDir();
    const userAgentsDir = path.join(configDir, 'agents');
    const userAgentDir = writeAgentDir(userAgentsDir, 'alpha');
    process.env.PONYBUNNY_CONFIG_DIR = configDir;

    const candidates = await discoverAgentCandidates({ workspaceDir });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'alpha',
      source: 'user',
      agentDir: userAgentDir,
    });
  });

  it('logs discovery source and precedence override decisions', async () => {
    const workspaceDir = createTempDir();
    const workspaceAgentsDir = path.join(workspaceDir, 'agents');
    writeAgentDir(workspaceAgentsDir, 'alpha');

    const configDir = createTempDir();
    const userAgentsDir = path.join(configDir, 'agents');
    writeAgentDir(userAgentsDir, 'alpha');
    process.env.PONYBUNNY_CONFIG_DIR = configDir;

    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await discoverAgentCandidates({ workspaceDir });

    expect(infoSpy).toHaveBeenCalledWith('[AgentDiscovery] Candidate discovered', {
      agentId: 'alpha',
      source: 'workspace',
      idMatches: true,
      configId: 'alpha',
    });

    expect(infoSpy).toHaveBeenCalledWith('[AgentDiscovery] Candidate discovered', {
      agentId: 'alpha',
      source: 'user',
      idMatches: true,
      configId: 'alpha',
    });

    expect(infoSpy).toHaveBeenCalledWith('[AgentDiscovery] Applying precedence override', {
      agentId: 'alpha',
      winnerSource: 'user',
      loserSource: 'workspace',
    });
  });

  it('marks mismatched config ids explicitly', async () => {
    const workspaceDir = createTempDir();
    const agentsDir = path.join(workspaceDir, 'agents');
    writeAgentDir(agentsDir, 'gamma', 'not-gamma');

    process.env.PONYBUNNY_CONFIG_DIR = createTempDir();

    const candidates = await discoverAgentCandidates({ workspaceDir });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'gamma',
      configId: 'not-gamma',
      idMatches: false,
    });
  });

  it('dedupes agents by canonical real paths', async () => {
    const workspaceDir = createTempDir();
    const agentsDir = path.join(workspaceDir, 'agents');
    const agentDir = writeAgentDir(agentsDir, 'delta');
    const aliasDir = path.join(agentsDir, 'delta-link');
    fs.symlinkSync(agentDir, aliasDir, 'dir');

    process.env.PONYBUNNY_CONFIG_DIR = createTempDir();

    const candidates = await discoverAgentCandidates({ workspaceDir });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].agentDirRealPath).toBe(fs.realpathSync(agentDir));
  });
});
