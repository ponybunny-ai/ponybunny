/**
 * Gateway Unit Tests
 */

import { EventBus } from '../src/gateway/events/event-bus.js';
import { Session } from '../src/gateway/connection/session.js';
import { MessageParser } from '../src/gateway/protocol/message-parser.js';
import { MethodRegistry } from '../src/gateway/rpc/method-registry.js';
import { ChallengeGenerator } from '../src/gateway/auth/challenge-generator.js';
import { GatewayError, ErrorCodes } from '../src/gateway/errors.js';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  test('should emit and receive events', () => {
    const handler = jest.fn();
    eventBus.on('test', handler);

    eventBus.emit('test', { value: 42 });

    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  test('should support multiple handlers', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    eventBus.on('test', handler1);
    eventBus.on('test', handler2);

    eventBus.emit('test', 'data');

    expect(handler1).toHaveBeenCalledWith('data');
    expect(handler2).toHaveBeenCalledWith('data');
  });

  test('should unsubscribe with returned function', () => {
    const handler = jest.fn();
    const unsubscribe = eventBus.on('test', handler);

    eventBus.emit('test', 1);
    unsubscribe();
    eventBus.emit('test', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  test('should handle once listeners', () => {
    const handler = jest.fn();
    eventBus.once('test', handler);

    eventBus.emit('test', 1);
    eventBus.emit('test', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  test('should remove all listeners', () => {
    const handler = jest.fn();
    eventBus.on('test', handler);
    eventBus.on('other', handler);

    eventBus.removeAllListeners();

    eventBus.emit('test', 1);
    eventBus.emit('other', 2);

    expect(handler).not.toHaveBeenCalled();
  });

  test('should remove listeners for specific event', () => {
    const handler = jest.fn();
    eventBus.on('test', handler);
    eventBus.on('other', handler);

    eventBus.removeAllListeners('test');

    eventBus.emit('test', 1);
    eventBus.emit('other', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(2);
  });
});

describe('Session', () => {
  test('should create session with data', () => {
    const session = new Session({
      id: 'sess_123',
      publicKey: 'abc123',
      permissions: ['read', 'write'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    expect(session.id).toBe('sess_123');
    expect(session.publicKey).toBe('abc123');
    expect(session.permissions).toEqual(['read', 'write']);
  });

  test('should check permissions correctly', () => {
    const session = new Session({
      id: 'sess_123',
      publicKey: 'abc123',
      permissions: ['read', 'write'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    expect(session.hasPermission('read')).toBe(true);
    expect(session.hasPermission('write')).toBe(true);
    expect(session.hasPermission('admin')).toBe(false);
  });

  test('should grant all permissions to admin', () => {
    const session = new Session({
      id: 'sess_123',
      publicKey: 'abc123',
      permissions: ['admin'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    expect(session.hasPermission('read')).toBe(true);
    expect(session.hasPermission('write')).toBe(true);
    expect(session.hasPermission('admin')).toBe(true);
  });

  test('should manage goal subscriptions', () => {
    const session = new Session({
      id: 'sess_123',
      publicKey: 'abc123',
      permissions: ['read'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    expect(session.isSubscribedToGoal('goal_1')).toBe(false);

    session.subscribeToGoal('goal_1');
    expect(session.isSubscribedToGoal('goal_1')).toBe(true);

    session.unsubscribeFromGoal('goal_1');
    expect(session.isSubscribedToGoal('goal_1')).toBe(false);
  });

  test('should update activity timestamp', () => {
    const session = new Session({
      id: 'sess_123',
      publicKey: 'abc123',
      permissions: ['read'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    const before = session.lastActivityAt;
    session.updateActivity();
    expect(session.lastActivityAt).toBeGreaterThan(before);
  });
});

describe('MessageParser', () => {
  let parser: MessageParser;

  beforeEach(() => {
    parser = new MessageParser();
  });

  test('should parse valid request frame', () => {
    const result = parser.parse(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'goal.submit',
      params: { title: 'Test' },
    }));

    expect(result.success).toBe(true);
    expect(result.frame).toEqual({
      type: 'req',
      id: 'req_1',
      method: 'goal.submit',
      params: { title: 'Test' },
    });
  });

  test('should parse request without params', () => {
    const result = parser.parse(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'system.ping',
    }));

    expect(result.success).toBe(true);
    expect(result.frame?.type).toBe('req');
  });

  test('should reject invalid JSON', () => {
    const result = parser.parse('not json');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.PARSE_ERROR);
  });

  test('should reject missing type', () => {
    const result = parser.parse(JSON.stringify({
      id: 'req_1',
      method: 'test',
    }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  test('should reject request without id', () => {
    const result = parser.parse(JSON.stringify({
      type: 'req',
      method: 'test',
    }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  test('should reject request without method', () => {
    const result = parser.parse(JSON.stringify({
      type: 'req',
      id: 'req_1',
    }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  test('should parse valid event frame', () => {
    const result = parser.parse(JSON.stringify({
      type: 'event',
      event: 'goal.created',
      data: { goalId: 'g_1' },
    }));

    expect(result.success).toBe(true);
    expect(result.frame).toEqual({
      type: 'event',
      event: 'goal.created',
      data: { goalId: 'g_1' },
    });
  });

  test('should parse valid response frame', () => {
    const result = parser.parse(JSON.stringify({
      type: 'res',
      id: 'req_1',
      result: { success: true },
    }));

    expect(result.success).toBe(true);
    expect(result.frame).toEqual({
      type: 'res',
      id: 'req_1',
      result: { success: true },
    });
  });

  test('should parse error response frame', () => {
    const result = parser.parse(JSON.stringify({
      type: 'res',
      id: 'req_1',
      error: { code: -32601, message: 'Method not found' },
    }));

    expect(result.success).toBe(true);
    expect(result.frame?.type).toBe('res');
  });
});

describe('MethodRegistry', () => {
  let registry: MethodRegistry;

  beforeEach(() => {
    registry = new MethodRegistry();
  });

  test('should register and execute methods', async () => {
    const handler = jest.fn().mockResolvedValue({ result: 'ok' });
    registry.register('test.method', ['read'], handler);

    const session = new Session({
      id: 'sess_1',
      publicKey: 'key',
      permissions: ['read'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    const result = await registry.execute('test.method', { arg: 1 }, session);

    expect(handler).toHaveBeenCalledWith({ arg: 1 }, session);
    expect(result).toEqual({ result: 'ok' });
  });

  test('should throw for unregistered method', async () => {
    const session = new Session({
      id: 'sess_1',
      publicKey: 'key',
      permissions: ['read'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    await expect(registry.execute('unknown', {}, session))
      .rejects.toThrow(GatewayError);
  });

  test('should check permissions', async () => {
    registry.register('admin.method', ['admin'], async () => 'ok');

    const session = new Session({
      id: 'sess_1',
      publicKey: 'key',
      permissions: ['read'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    await expect(registry.execute('admin.method', {}, session))
      .rejects.toThrow(GatewayError);
  });

  test('should allow methods with no required permissions', async () => {
    registry.register('public.method', [], async () => 'ok');

    const session = new Session({
      id: 'sess_1',
      publicKey: 'key',
      permissions: [],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    const result = await registry.execute('public.method', {}, session);
    expect(result).toBe('ok');
  });

  test('should list accessible methods', () => {
    registry.register('read.method', ['read'], async () => {});
    registry.register('write.method', ['write'], async () => {});
    registry.register('admin.method', ['admin'], async () => {});
    registry.register('public.method', [], async () => {});

    const readSession = new Session({
      id: 'sess_1',
      publicKey: 'key',
      permissions: ['read'],
      connectedAt: 1000,
      lastActivityAt: 1000,
    });

    const accessible = registry.listAccessible(readSession);
    expect(accessible).toContain('read.method');
    expect(accessible).toContain('public.method');
    expect(accessible).not.toContain('write.method');
    expect(accessible).not.toContain('admin.method');
  });
});

describe('ChallengeGenerator', () => {
  let generator: ChallengeGenerator;

  beforeEach(() => {
    generator = new ChallengeGenerator({ challengeTtlMs: 1000 });
  });

  test('should generate unique challenges', () => {
    const c1 = generator.generate('conn_1');
    const c2 = generator.generate('conn_2');

    expect(c1.challenge).not.toBe(c2.challenge);
    expect(c1.challenge.length).toBe(64); // 32 bytes = 64 hex chars
  });

  test('should retrieve pending challenge', () => {
    const generated = generator.generate('conn_1');
    const retrieved = generator.getChallenge('conn_1');

    expect(retrieved).toEqual(generated);
  });

  test('should consume challenge', () => {
    generator.generate('conn_1');
    const consumed = generator.consumeChallenge('conn_1');
    const afterConsume = generator.getChallenge('conn_1');

    expect(consumed).toBeDefined();
    expect(afterConsume).toBeUndefined();
  });

  test('should expire challenges', async () => {
    const shortGenerator = new ChallengeGenerator({ challengeTtlMs: 50 });
    shortGenerator.generate('conn_1');

    await new Promise(resolve => setTimeout(resolve, 100));

    const retrieved = shortGenerator.getChallenge('conn_1');
    expect(retrieved).toBeUndefined();
  });
});

describe('GatewayError', () => {
  test('should create error with code', () => {
    const error = new GatewayError(ErrorCodes.AUTH_REQUIRED);

    expect(error.code).toBe(ErrorCodes.AUTH_REQUIRED);
    expect(error.message).toBe('Authentication required');
  });

  test('should create error with custom message', () => {
    const error = new GatewayError(ErrorCodes.AUTH_FAILED, 'Custom reason');

    expect(error.code).toBe(ErrorCodes.AUTH_FAILED);
    expect(error.message).toBe('Custom reason');
  });

  test('should convert to RPC error', () => {
    const error = new GatewayError(ErrorCodes.METHOD_NOT_FOUND, 'test.method', { extra: 'data' });
    const rpcError = error.toRpcError();

    expect(rpcError.code).toBe(ErrorCodes.METHOD_NOT_FOUND);
    expect(rpcError.message).toBe('test.method');
    expect(rpcError.data).toEqual({ extra: 'data' });
  });

  test('should create from static methods', () => {
    expect(GatewayError.parseError().code).toBe(ErrorCodes.PARSE_ERROR);
    expect(GatewayError.invalidRequest().code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(GatewayError.methodNotFound('test').code).toBe(ErrorCodes.METHOD_NOT_FOUND);
    expect(GatewayError.authRequired().code).toBe(ErrorCodes.AUTH_REQUIRED);
    expect(GatewayError.permissionDenied().code).toBe(ErrorCodes.PERMISSION_DENIED);
  });

  test('should create not found errors', () => {
    expect(GatewayError.notFound('goal', 'g_1').code).toBe(ErrorCodes.GOAL_NOT_FOUND);
    expect(GatewayError.notFound('workitem', 'w_1').code).toBe(ErrorCodes.WORKITEM_NOT_FOUND);
    expect(GatewayError.notFound('escalation', 'e_1').code).toBe(ErrorCodes.ESCALATION_NOT_FOUND);
    expect(GatewayError.notFound('run', 'r_1').code).toBe(ErrorCodes.RUN_NOT_FOUND);
  });
});
