import fs from 'node:fs';
import path from 'node:path';
import { discoverAgentCandidates } from '../../../src/infra/agents/agent-discovery.js';
import { validateAgentConfig } from '../../../src/infra/agents/config/agent-config-validator.js';
import { compileAgentConfig } from '../../../src/infra/agents/config/agent-config-types.js';
import { RunnerRegistry } from '../../../src/infra/agents/runner-registry.js';
import { createSchemaDrivenAgentRunner } from '../../../src/infra/agents/schema-driven-agent-runner.js';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const AGENT_DIR = path.join(REPO_ROOT, 'agents', 'entropy-checker');
const AGENT_JSON = path.join(AGENT_DIR, 'agent.json');

const ORIGINAL_CONFIG_DIR = process.env.PONYBUNNY_CONFIG_DIR;

describe('Entropy Checker Agent', () => {
  afterEach(() => {
    if (ORIGINAL_CONFIG_DIR === undefined) {
      delete process.env.PONYBUNNY_CONFIG_DIR;
    } else {
      process.env.PONYBUNNY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
    }
  });

  it('agent.json exists on disk', () => {
    expect(fs.existsSync(AGENT_JSON)).toBe(true);
  });

  it('agent.json is valid JSON with required fields', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    expect(raw.id).toBe('entropy-checker');
    expect(raw.enabled).toBe(true);
    expect(raw.type).toBe('harness');
    expect(raw.schedule).toBeDefined();
    expect(raw.policy).toBeDefined();
    expect(raw.runner).toBeDefined();
  });

  it('passes agent config validation', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    // validateAgentConfig throws if invalid
    const validated = validateAgentConfig(raw);
    expect(validated.id).toBe('entropy-checker');
    expect(validated.enabled).toBe(true);
  });

  it('is discoverable from workspace agents directory', async () => {
    // Point config dir to a temp location to avoid user-agent interference
    process.env.PONYBUNNY_CONFIG_DIR = path.join(REPO_ROOT, 'test', '.tmp-config-dir');

    const candidates = await discoverAgentCandidates({
      workspaceDir: REPO_ROOT,
      logger: { info: () => {} } as Pick<Console, 'info'>,
    });

    const entropyCandidate = candidates.find(c => c.id === 'entropy-checker');
    expect(entropyCandidate).toBeDefined();
    expect(entropyCandidate!.source).toBe('workspace');
    expect(entropyCandidate!.configId).toBe('entropy-checker');
    expect(entropyCandidate!.idMatches).toBe(true);
  });

  it('runner registry resolves to schema-driven runner', () => {
    const registry = new RunnerRegistry();
    const schemaRunner = createSchemaDrivenAgentRunner();
    registry.register('default', schemaRunner);
    registry.register('harness', schemaRunner);

    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    const validated = validateAgentConfig(raw);
    const compiled = compileAgentConfig(validated);

    const runner = registry.resolve('entropy-checker', compiled);
    expect(runner).not.toBeNull();
    expect(runner).toBe(schemaRunner);
  });

  it('has read-only policy with no write/execute tools', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    const allowlist = raw.policy.toolAllowlist;
    const denylist = raw.policy.toolDenylist;

    expect(allowlist).toContain('read_file');
    expect(allowlist).toContain('list_dir');
    expect(allowlist).toContain('search_code');
    expect(denylist).toContain('write_file');
    expect(denylist).toContain('execute_command');
    expect(denylist).toContain('web_search');
  });

  it('has schedule configured for weekly Monday runs', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    expect(raw.schedule.enabled).toBe(true);
    expect(raw.schedule.everyMs).toBe(604800000); // 7 days
    expect(raw.schedule.windows).toHaveLength(1);
    expect(raw.schedule.windows[0].days).toContain('mon');
    expect(raw.schedule.windows[0].start).toBe('03:00');
    expect(raw.schedule.windows[0].end).toBe('05:00');
  });

  it('has consistency check prompt covering all 5 dimensions', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    const prompt = raw.policy.prompts.consistency_check;
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).toContain('reverse-engineering');
    expect(prompt).toContain('schemas');
    expect(prompt).toContain('agent-registry');
    expect(prompt).toContain('Failure Patterns');
  });

  it('has check_dimensions matching prompt content', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    const dimensions = raw.runner.config.check_dimensions;
    expect(dimensions).toContain('claude_md_roles_vs_skills');
    expect(dimensions).toContain('reverse_eng_docs_vs_rpc');
    expect(dimensions).toContain('schemas_vs_config');
    expect(dimensions).toContain('agent_configs_validity');
    expect(dimensions).toContain('failure_patterns_freshness');
    expect(dimensions).toHaveLength(5);
  });

  it('has circuit breaker configuration', () => {
    const raw = JSON.parse(fs.readFileSync(AGENT_JSON, 'utf-8'));
    const cb = raw.runner.config.circuit_breaker;
    expect(cb.failure_threshold).toBeGreaterThan(0);
    expect(cb.backoff_minutes).toBeGreaterThan(0);
  });
});
