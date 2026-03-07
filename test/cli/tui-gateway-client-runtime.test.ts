import { TuiGatewayClient } from '../../src/cli/gateway/tui-gateway-client.js';

jest.mock('../../src/cli/gateway/gateway-client.js', () => {
  const request = jest.fn().mockResolvedValue({ ok: true });
  let lastOptions: unknown;

  class MockGatewayClient {
    public url = 'ws://127.0.0.1:18789';
    public request = request;
    public onConnected?: () => void;
    public onDisconnected?: (reason: string) => void;
    public onEvent?: (event: string, data: unknown) => void;
    public onError?: (error: Error) => void;

    constructor(options?: unknown) {
      lastOptions = options;
    }

    public start = jest.fn();
    stop(): void {}
    isConnected(): boolean { return true; }
  }

  return {
    GatewayClient: MockGatewayClient,
    __requestMock: request,
    __getLastOptions: () => lastOptions,
  };
});

jest.mock('../../src/cli/lib/key-manager.js', () => ({
  hasKeyPair: jest.fn(() => false),
  getPublicKey: jest.fn(() => 'pk-test'),
  signChallenge: jest.fn(() => 'sig-test'),
}));

describe('TuiGatewayClient internal runtime API wrappers', () => {
  function getRequestMock(client: TuiGatewayClient): jest.Mock {
    return (client as unknown as { client: { request: jest.Mock } }).client.request;
  }

  it('forwards channel identity options to GatewayClient', async () => {
    const client = new TuiGatewayClient({
      reconnect: false,
      token: 'token-abc',
      channelType: 'discord',
      channelSessionId: 'discord-thread-1',
    });

    const gatewayClientModule = jest.requireMock('../../src/cli/gateway/gateway-client.js') as {
      __getLastOptions: () => {
        token?: string;
        channelType?: string;
        channelSessionId?: string;
      };
    };
    const options = gatewayClientModule.__getLastOptions();

    expect(options).toEqual(expect.objectContaining({
      token: 'token-abc',
      channelType: 'discord',
      channelSessionId: 'discord-thread-1',
    }));
    expect(client).toBeInstanceOf(TuiGatewayClient);
  });

  it('calls internal.runtime.config', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.getInternalRuntimeConfig();

    expect(requestMock).toHaveBeenCalledWith('internal.runtime.config', {});
  });

  it('calls internal plan/compile/create run methods', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.getInternalPlan('goal-1');
    await client.compileInternalPlan({ schema_version: 'plan.v1' }, { profile_id: 'default' });
    await client.createInternalRun('plan-1', { accepted: true }, 'compile-plan-1');

    expect(requestMock).toHaveBeenNthCalledWith(1, 'internal.plan.get', { goalId: 'goal-1' });
    expect(requestMock).toHaveBeenNthCalledWith(2, 'internal.plan.compile', {
      plan: { schema_version: 'plan.v1' },
      runtimeProfile: { profile_id: 'default' },
    });
    expect(requestMock).toHaveBeenNthCalledWith(3, 'internal.run.create', {
      planId: 'plan-1',
      acceptedPlan: { accepted: true },
      compileRunId: 'compile-plan-1',
    });
  });

  it('calls internal runs events/timeline/replay/dryRun methods', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.getInternalRunEvents({ runId: 'run-1', limit: 10, offset: 0 });
    await client.getInternalRunTimeline('run-1', 'run-2');
    await client.replayInternalRun('run-1', 'run-2');
    await client.executeInternalRuntimeDryRun({ goalId: 'goal-1' });

    expect(requestMock).toHaveBeenNthCalledWith(1, 'internal.runs.events', {
      runId: 'run-1',
      limit: 10,
      offset: 0,
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, 'internal.runs.timeline', {
      runId: 'run-1',
      relatedRunId: 'run-2',
    });
    expect(requestMock).toHaveBeenNthCalledWith(3, 'internal.runs.replay', {
      runId: 'run-1',
      relatedRunId: 'run-2',
      mode: 'facts_only',
    });
    expect(requestMock).toHaveBeenNthCalledWith(4, 'internal.runtime.executeDryRun', {
      goalId: 'goal-1',
    });
  });

  it('calls internal.runs.events.prune wrapper', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.pruneInternalRunEvents({
      beforeTsMs: 1_700_000_000_000,
      runId: 'run-1',
      eventTypes: ['PLAN_COMPILE_REQUESTED'],
      keepLatestPerRun: 1,
    });

    expect(requestMock).toHaveBeenCalledWith('internal.runs.events.prune', {
      beforeTsMs: 1_700_000_000_000,
      runId: 'run-1',
      eventTypes: ['PLAN_COMPILE_REQUESTED'],
      keepLatestPerRun: 1,
    });
  });

  it('passes cursor field through internal runs events wrapper', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.getInternalRunEvents({ runId: 'run-1', limit: 5, cursor: '10' });

    expect(requestMock).toHaveBeenCalledWith('internal.runs.events', {
      runId: 'run-1',
      limit: 5,
      cursor: '10',
    });
  });

  it('passes reexecute_tools replay mode through wrapper', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.replayInternalRun('run-9', undefined, 'reexecute_tools');

    expect(requestMock).toHaveBeenCalledWith('internal.runs.replay', {
      runId: 'run-9',
      relatedRunId: undefined,
      mode: 'reexecute_tools',
    });
  });

  it('passes replay options through wrapper', async () => {
    const client = new TuiGatewayClient({ reconnect: false });
    const requestMock = getRequestMock(client);
    requestMock.mockClear();

    await client.replayInternalRun('run-10', 'run-11', 'reexecute_tools', {
      allowTools: ['local://read_file'],
      maxAttempts: 5,
      enableExecution: true,
      reexecutionIdempotencyKey: 'idem-001',
    });

    expect(requestMock).toHaveBeenCalledWith('internal.runs.replay', {
      runId: 'run-10',
      relatedRunId: 'run-11',
      mode: 'reexecute_tools',
      allowTools: ['local://read_file'],
      maxAttempts: 5,
      enableExecution: true,
      reexecutionIdempotencyKey: 'idem-001',
    });
  });
});
