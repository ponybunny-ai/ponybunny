/**
 * Tests for the Harness Dashboard API route logic.
 *
 * The actual route lives at web/src/app/api/dashboard/route.ts but depends on
 * next/server (NextResponse) which is only installed in the web/ workspace.
 *
 * Strategy: replicate the core callGatewayRPC + GET handler logic here and
 * test it in isolation, since the route file cannot be directly imported
 * from the main project's test runner without next.js module resolution.
 *
 * This tests the same behavioural contract the route implements:
 *  - WebSocket RPC call mechanics
 *  - GET handler response shaping with Promise.allSettled
 *  - Graceful degradation when one or both RPC calls fail
 *  - Timeout handling
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Reproduce the route's core types and logic (kept in sync with route.ts)
// ---------------------------------------------------------------------------

interface ResponseFrame {
  type: 'res';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface DashboardData {
  scheduler: {
    totalGoalsProcessed: number;
    totalWorkItemsCompleted: number;
    totalRunsExecuted: number;
    averageWorkItemDurationMs: number;
    successRate: number;
    currentActiveGoals: number;
    currentActiveWorkItems: number;
  } | null;
  audit: {
    total: number;
    by_action: Record<string, number>;
    by_entity_type: Record<string, number>;
  } | null;
}

// ---------------------------------------------------------------------------
// Fake WebSocket that behaves like the ws library
// ---------------------------------------------------------------------------

class FakeWebSocket extends EventEmitter {
  sent: string[] = [];
  closed = false;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  /** Simulate server sending a response frame */
  simulateMessage(frame: ResponseFrame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }

  /** Simulate connection open */
  simulateOpen() {
    this.emit('open');
  }

  /** Simulate connection error */
  simulateError(err: Error) {
    this.emit('error', err);
  }

  /** Simulate connection close */
  simulateClose() {
    this.emit('close');
  }
}

// ---------------------------------------------------------------------------
// callGatewayRPC - extracted from route.ts for testability
// ---------------------------------------------------------------------------

function callGatewayRPC<T>(
  createWs: () => FakeWebSocket,
  method: string,
  params: unknown = {},
  timeoutMs = 10000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = createWs();
    const requestId = 'test-request-id'; // deterministic for tests
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeout);
      ws.close();
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Request timeout'));
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'req', id: requestId, method, params }));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString()) as ResponseFrame;
        if (frame.type === 'res' && frame.id === requestId) {
          cleanup();
          if (frame.error) reject(new Error(frame.error.message));
          else resolve(frame.result as T);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    ws.on('error', (error) => { cleanup(); reject(error); });
    ws.on('close', () => { cleanup(); reject(new Error('Connection closed')); });
  });
}

// ---------------------------------------------------------------------------
// GET handler logic - mirrors route.ts GET()
// ---------------------------------------------------------------------------

async function getDashboardData(
  createWs: () => FakeWebSocket,
): Promise<{ data?: DashboardData; error?: string; status: number }> {
  try {
    const [schedulerResult, auditResult] = await Promise.allSettled([
      callGatewayRPC<{ metrics: DashboardData['scheduler'] }>(createWs, 'debug.scheduler', {}),
      callGatewayRPC<DashboardData['audit']>(createWs, 'audit.stats', {}),
    ]);

    const data: DashboardData = {
      scheduler: schedulerResult.status === 'fulfilled' ? schedulerResult.value.metrics : null,
      audit: auditResult.status === 'fulfilled' ? auditResult.value : null,
    };

    return { data, status: 200 };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      status: 500,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSchedulerMetrics(overrides: Partial<NonNullable<DashboardData['scheduler']>> = {}): NonNullable<DashboardData['scheduler']> {
  return {
    totalGoalsProcessed: 10,
    totalWorkItemsCompleted: 20,
    totalRunsExecuted: 25,
    averageWorkItemDurationMs: 3500,
    successRate: 0.85,
    currentActiveGoals: 2,
    currentActiveWorkItems: 3,
    ...overrides,
  };
}

function makeAuditData(overrides: Partial<NonNullable<DashboardData['audit']>> = {}): NonNullable<DashboardData['audit']> {
  return {
    total: 150,
    by_action: { create: 80, update: 50, delete: 20 },
    by_entity_type: { goal: 60, work_item: 50, run: 40 },
    ...overrides,
  };
}

/** Create a FakeWebSocket factory that auto-responds to RPC calls */
function createAutoRespondingWsFactory(responses: Record<string, unknown>): () => FakeWebSocket {
  return () => {
    const ws = new FakeWebSocket();
    // Auto-open after construction (next tick)
    queueMicrotask(() => ws.simulateOpen());
    ws.on('open', () => {
      // After the caller sends, respond on next tick
      const originalSend = ws.send.bind(ws);
      ws.send = (data: string) => {
        originalSend(data);
        const req = JSON.parse(data);
        const result = responses[req.method];
        queueMicrotask(() => {
          if (result !== undefined) {
            ws.simulateMessage({ type: 'res', id: req.id, result });
          } else {
            ws.simulateMessage({
              type: 'res',
              id: req.id,
              error: { code: -1, message: `Unknown method: ${req.method}` },
            });
          }
        });
      };
    });
    return ws;
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Dashboard API - callGatewayRPC', () => {
  test('resolves with result on successful response', async () => {
    const ws = new FakeWebSocket();
    const promise = callGatewayRPC<{ value: number }>(
      () => ws,
      'test.method',
      { key: 'val' },
    );

    ws.simulateOpen();
    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.method).toBe('test.method');
    expect(sent.params).toEqual({ key: 'val' });

    ws.simulateMessage({ type: 'res', id: sent.id, result: { value: 42 } });

    const result = await promise;
    expect(result).toEqual({ value: 42 });
    expect(ws.closed).toBe(true);
  });

  test('rejects with error message from RPC error frame', async () => {
    const ws = new FakeWebSocket();
    const promise = callGatewayRPC(() => ws, 'bad.method');

    ws.simulateOpen();
    const sent = JSON.parse(ws.sent[0]);
    ws.simulateMessage({
      type: 'res',
      id: sent.id,
      error: { code: 404, message: 'Method not found' },
    });

    await expect(promise).rejects.toThrow('Method not found');
    expect(ws.closed).toBe(true);
  });

  test('rejects on WebSocket error event', async () => {
    const ws = new FakeWebSocket();
    const promise = callGatewayRPC(() => ws, 'test.method');

    ws.simulateError(new Error('ECONNREFUSED'));

    await expect(promise).rejects.toThrow('ECONNREFUSED');
    expect(ws.closed).toBe(true);
  });

  test('rejects on WebSocket close before response', async () => {
    const ws = new FakeWebSocket();
    const promise = callGatewayRPC(() => ws, 'test.method');

    ws.simulateClose();

    await expect(promise).rejects.toThrow('Connection closed');
  });

  test('rejects on timeout', async () => {
    jest.useFakeTimers();

    const ws = new FakeWebSocket();
    const promise = callGatewayRPC(() => ws, 'slow.method', {}, 5000);

    jest.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow('Request timeout');
    expect(ws.closed).toBe(true);

    jest.useRealTimers();
  });

  test('ignores response frames with mismatched request ID', async () => {
    const ws = new FakeWebSocket();
    const promise = callGatewayRPC(() => ws, 'test.method');

    ws.simulateOpen();
    const sent = JSON.parse(ws.sent[0]);

    // Send a response with wrong ID -- should be ignored
    ws.simulateMessage({ type: 'res', id: 'wrong-id', result: { wrong: true } });

    // Now send the correct one
    ws.simulateMessage({ type: 'res', id: sent.id, result: { correct: true } });

    const result = await promise;
    expect(result).toEqual({ correct: true });
  });
});

describe('Dashboard API - GET handler', () => {
  test('returns full dashboard data when both RPC calls succeed', async () => {
    const metrics = makeSchedulerMetrics();
    const audit = makeAuditData();

    const factory = createAutoRespondingWsFactory({
      'debug.scheduler': { metrics },
      'audit.stats': audit,
    });

    const response = await getDashboardData(factory);

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    expect(response.data!.scheduler).toEqual(metrics);
    expect(response.data!.audit).toEqual(audit);
  });

  test('returns scheduler=null when scheduler RPC fails', async () => {
    const audit = makeAuditData();

    // Only audit.stats responds successfully; debug.scheduler gets an error
    const factory = createAutoRespondingWsFactory({
      'audit.stats': audit,
      // debug.scheduler not in map -> triggers error response
    });

    const response = await getDashboardData(factory);

    expect(response.status).toBe(200);
    expect(response.data!.scheduler).toBeNull();
    expect(response.data!.audit).toEqual(audit);
  });

  test('returns audit=null when audit RPC fails', async () => {
    const metrics = makeSchedulerMetrics();

    const factory = createAutoRespondingWsFactory({
      'debug.scheduler': { metrics },
      // audit.stats not in map -> triggers error response
    });

    const response = await getDashboardData(factory);

    expect(response.status).toBe(200);
    expect(response.data!.scheduler).toEqual(metrics);
    expect(response.data!.audit).toBeNull();
  });

  test('returns both null when both RPC calls fail (empty/offline gateway)', async () => {
    // No methods respond successfully
    const factory = createAutoRespondingWsFactory({});

    const response = await getDashboardData(factory);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ scheduler: null, audit: null });
  });

  test('returns correct metrics shape with zero values', async () => {
    const emptyMetrics = makeSchedulerMetrics({
      totalGoalsProcessed: 0,
      totalWorkItemsCompleted: 0,
      totalRunsExecuted: 0,
      averageWorkItemDurationMs: 0,
      successRate: 0,
      currentActiveGoals: 0,
      currentActiveWorkItems: 0,
    });

    const factory = createAutoRespondingWsFactory({
      'debug.scheduler': { metrics: emptyMetrics },
      'audit.stats': { total: 0, by_action: {}, by_entity_type: {} },
    });

    const response = await getDashboardData(factory);

    expect(response.status).toBe(200);
    expect(response.data!.scheduler!.successRate).toBe(0);
    expect(response.data!.scheduler!.totalRunsExecuted).toBe(0);
    expect(response.data!.audit!.total).toBe(0);
    expect(response.data!.audit!.by_action).toEqual({});
  });
});
