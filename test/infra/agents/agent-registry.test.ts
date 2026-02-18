import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AgentRegistry } from '../../../src/infra/agents/agent-registry.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agent-registry-'));
}

function writeAgentDir(baseDir: string, id: string, configOverride: Record<string, unknown> = {}): string {
  const agentDir = path.join(baseDir, id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), `# ${id}
`, 'utf-8');

  const config = {
    schemaVersion: 1,
    id,
    name: `${id} agent`,
    enabled: true,
    type: 'market_listener',
    schedule: { everyMs: 60000 },
    policy: {},
    runner: {},
    ...configOverride,
  };

  fs.writeFileSync(
    path.join(agentDir, 'agent.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );

  return agentDir;
}

function canonicalize(value: unknown): string {
  const sortValue = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(sortValue);
    }

    if (input && typeof input === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        sorted[key] = sortValue((input as Record<string, unknown>)[key]);
      }
      return sorted;
    }

    return input;
  };

  return JSON.stringify(sortValue(value));
}

describe('AgentRegistry', () => {
  it('loads a valid agent and exposes markdown and definition hash', async () => {
    const workspaceDir = createTempDir();
    const agentsDir = path.join(workspaceDir, 'agents');
    writeAgentDir(agentsDir, 'alpha');

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir, userDir: createTempDir() });

    const agent = registry.getAgent('alpha');
    expect(agent).toBeDefined();
    expect(agent?.status).toBe('valid');
    expect(agent?.markdown).toBe('# alpha\n');

    const config = {
      schemaVersion: 1,
      id: 'alpha',
      name: 'alpha agent',
      enabled: true,
      type: 'market_listener',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    };
    const expectedHash = createHash('sha256').update(canonicalize(config)).digest('hex');
    expect(agent?.definitionHash).toBe(expectedHash);
  });

  it('serves last-good when a config becomes invalid', async () => {
    const workspaceDir = createTempDir();
    const agentsDir = path.join(workspaceDir, 'agents');
    const agentDir = writeAgentDir(agentsDir, 'beta');

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir, userDir: createTempDir() });

    const first = registry.getAgent('beta');
    expect(first?.status).toBe('valid');
    const firstHash = first?.definitionHash;

    const invalidConfig = {
      schemaVersion: 1,
      id: 'beta',
      enabled: true,
      type: 'market_listener',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    };
    fs.writeFileSync(
      path.join(agentDir, 'agent.json'),
      JSON.stringify(invalidConfig, null, 2),
      'utf-8'
    );

    await registry.reload();

    const updated = registry.getAgent('beta');
    expect(updated?.status).toBe('using_last_good');
    expect(updated?.definitionHash).toBe(firstHash);
    expect(updated?.config.name).toBe('beta agent');
  });

  it('skips an invalid config at startup without throwing', async () => {
    const workspaceDir = createTempDir();
    const agentsDir = path.join(workspaceDir, 'agents');
    const agentDir = path.join(agentsDir, 'gamma');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'AGENT.md'), '# gamma\n', 'utf-8');
    fs.writeFileSync(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({ schemaVersion: 1, id: 'gamma' }, null, 2),
      'utf-8'
    );

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir, userDir: createTempDir() });

    expect(registry.getAgent('gamma')).toBeUndefined();
  });

  it('loads the workspace agent-a definition with defaults', async () => {
    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir: process.cwd(), userDir: createTempDir() });

    const agent = registry.getAgent('agent-a');
    expect(agent).toBeDefined();
    expect(agent?.status).toBe('valid');
    expect(agent?.config.enabled).toBe(true);
    expect(agent?.config.schedule.kind).toBe('interval');
    expect(agent?.config.schedule.everyMs).toBe(60000);
  });
});
