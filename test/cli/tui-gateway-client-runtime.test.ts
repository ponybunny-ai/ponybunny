import { TuiGatewayClient } from '../../src/cli/gateway/tui-gateway-client.js';

jest.mock('../../src/cli/gateway/gateway-client.js', () => {
  const request = jest.fn().mockResolvedValue({ ok: true });

  class MockGatewayClient {
    public url = 'ws://127.0.0.1:18789';
    public request = request;
    public onConnected?: () => void;
    public onDisconnected?: (reason: string) => void;
    public onEvent?: (event: string, data: unknown) => void;
    public onError?: (error: Error) => void;

    start(): void {}
    stop(): void {}
    isConnected(): boolean { return true; }
  }

  return {
    GatewayClient: MockGatewayClient,
  };
});

describe('TuiGatewayClient internal runtime API wrappers', () => {
  function getRequestMock(client: TuiGatewayClient): jest.Mock {
    return (client as unknown as { client: { request: jest.Mock } }).client.request;
  }

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
    });

    expect(requestMock).toHaveBeenCalledWith('internal.runs.replay', {
      runId: 'run-10',
      relatedRunId: 'run-11',
      mode: 'reexecute_tools',
      allowTools: ['local://read_file'],
      maxAttempts: 5,
      enableExecution: true,
    });
  });
});
