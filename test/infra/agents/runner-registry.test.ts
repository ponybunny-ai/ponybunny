import { RunnerRegistry } from '../../../src/infra/agents/runner-registry.js';
import type { AgentRunner } from '../../../src/infra/agents/runner-types.js';
import { compileAgentConfig } from '../../../src/infra/agents/config/index.js';

describe('RunnerRegistry', () => {
  it('resolves a registered runner and executes a tick', async () => {
    const registry = new RunnerRegistry();
    const runTick = jest.fn<ReturnType<AgentRunner['runTick']>, Parameters<AgentRunner['runTick']>>();
    const runner: AgentRunner = { runTick };
    registry.register('market_listener', runner);

    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'agent-a',
      name: 'Agent A',
      enabled: true,
      type: 'market_listener',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    });

    const tickContext = {
      now: new Date('2026-01-01T00:00:00.000Z'),
      runKey: 'run-123',
    };

    const resolved = registry.resolve(config.id, config);
    expect(resolved).toBe(runner);
    await resolved?.runTick({ agentId: config.id, config, tick: tickContext });
    expect(runTick).toHaveBeenCalledWith({
      agentId: config.id,
      config,
      tick: tickContext,
    });
  });

  it('throws for enabled agents with unknown runner types', () => {
    const registry = new RunnerRegistry();
    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'unknown-agent',
      name: 'Unknown Agent',
      enabled: true,
      type: 'unknown_type',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    });

    expect(() => registry.resolve(config.id, config)).toThrow(
      "Unknown runner type 'unknown_type' for enabled agent 'unknown-agent'"
    );
  });
});
