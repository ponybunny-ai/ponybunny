import {
  buildCronRouteContext,
  normalizeRouteContext,
  routeContextFromWorkItemContext,
} from '../../../src/infra/routing/route-context.js';

describe('route-context', () => {
  it('normalizes snake_case fields and trims values', () => {
    const result = normalizeRouteContext({
      source: ' gateway.message ',
      provider_id: 'openai/gpt-5.3-codex',
      account_id: ' account-1 ',
      sender_is_owner: true,
      is_sandboxed: true,
      is_subagent: false,
      run_key: 'run-1',
      matched_by: 'binding',
      channel: ' telegram ',
    });

    expect(result).toEqual({
      source: 'gateway.message',
      providerId: 'openai/gpt-5.3-codex',
      accountId: 'account-1',
      senderIsOwner: true,
      sandboxed: true,
      isSubagent: false,
      runKey: 'run-1',
      matchedBy: 'binding',
      channel: 'telegram',
      agentId: undefined,
      senderId: undefined,
      sessionKey: undefined,
      mainSessionKey: undefined,
    });
  });

  it('returns undefined for invalid route context payloads', () => {
    expect(normalizeRouteContext(null)).toBeUndefined();
    expect(normalizeRouteContext(undefined)).toBeUndefined();
    expect(normalizeRouteContext('invalid')).toBeUndefined();
  });

  it('extracts routeContext and route_context aliases from work item context', () => {
    const camelCase = routeContextFromWorkItemContext({
      routeContext: {
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
      },
    });
    const snakeCase = routeContextFromWorkItemContext({
      route_context: {
        source: 'gateway.message',
        provider_id: 'anthropic/claude-sonnet-4.5',
      },
    });

    expect(camelCase?.providerId).toBe('openai/gpt-5.3-codex');
    expect(snakeCase?.providerId).toBe('anthropic/claude-sonnet-4.5');
    expect(routeContextFromWorkItemContext(undefined)).toBeUndefined();
  });

  it('builds deterministic cron route context artifact', () => {
    const result = buildCronRouteContext({
      agentId: 'agent-1',
      runKey: 'run-1',
      providerId: 'openai/gpt-5.3-codex',
    });

    expect(result).toEqual({
      source: 'scheduler.cron',
      providerId: 'openai/gpt-5.3-codex',
      channel: 'internal',
      agentId: 'agent-1',
      runKey: 'run-1',
      matchedBy: 'cron_schedule',
      senderIsOwner: true,
      sandboxed: false,
      isSubagent: false,
    });
  });
});
