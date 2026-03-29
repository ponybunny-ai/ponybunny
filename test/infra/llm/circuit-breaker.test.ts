import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../../src/infra/llm/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../../../src/infra/llm/circuit-breaker.js';

describe('CircuitBreaker', () => {
  const testConfig: CircuitBreakerConfig = {
    failureThreshold: 3,
    successThreshold: 2,
    cooldownMs: 1000,
    monitoredErrorCodes: ['server_error', 'timeout', 'network_error', 'rate_limited'],
  };

  it('starts in closed state allowing all calls', () => {
    const cb = new CircuitBreaker('test-endpoint', testConfig);
    expect(cb.isCallAllowed()).toBe(true);
    expect(cb.getStatus().state).toBe('closed');
  });

  it('remains closed below failure threshold', () => {
    const cb = new CircuitBreaker('test-endpoint', testConfig);
    cb.recordFailure('server_error');
    cb.recordFailure('server_error');
    expect(cb.isCallAllowed()).toBe(true);
    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(2);
  });

  it('opens after failure threshold is reached', () => {
    const cb = new CircuitBreaker('test-endpoint', testConfig);
    cb.recordFailure('server_error');
    cb.recordFailure('timeout');
    cb.recordFailure('network_error');
    expect(cb.getStatus().state).toBe('open');
    expect(cb.isCallAllowed()).toBe(false);
  });

  it('ignores non-monitored error codes', () => {
    const cb = new CircuitBreaker('test-endpoint', testConfig);
    cb.recordFailure('auth_failed');
    cb.recordFailure('content_policy');
    cb.recordFailure('quota_exceeded');
    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it('resets failure count on success', () => {
    const cb = new CircuitBreaker('test-endpoint', testConfig);
    cb.recordFailure('server_error');
    cb.recordFailure('server_error');
    expect(cb.getStatus().failureCount).toBe(2);

    cb.recordSuccess();
    expect(cb.getStatus().failureCount).toBe(0);
    expect(cb.getStatus().state).toBe('closed');
  });

  it('transitions to half-open after cooldown', () => {
    const cb = new CircuitBreaker('test-endpoint', {
      ...testConfig,
      cooldownMs: 50, // Short for testing
    });

    // Open the breaker
    cb.recordFailure('server_error');
    cb.recordFailure('server_error');
    cb.recordFailure('server_error');
    expect(cb.isCallAllowed()).toBe(false);

    // Wait for cooldown
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.isCallAllowed()).toBe(true); // Transitions to half-open
        expect(cb.getStatus().state).toBe('half-open');
        resolve();
      }, 60);
    });
  });

  it('closes from half-open after enough successes', () => {
    const cb = new CircuitBreaker('test-endpoint', {
      ...testConfig,
      cooldownMs: 10,
    });

    // Open → half-open
    for (let i = 0; i < 3; i++) cb.recordFailure('server_error');

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        cb.isCallAllowed(); // Trigger half-open transition

        cb.recordSuccess();
        expect(cb.getStatus().state).toBe('half-open');

        cb.recordSuccess();
        expect(cb.getStatus().state).toBe('closed');
        expect(cb.isCallAllowed()).toBe(true);
        resolve();
      }, 20);
    });
  });

  it('re-opens from half-open on monitored failure', () => {
    const cb = new CircuitBreaker('test-endpoint', {
      ...testConfig,
      cooldownMs: 10,
    });

    // Open → half-open
    for (let i = 0; i < 3; i++) cb.recordFailure('server_error');

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        cb.isCallAllowed(); // half-open
        expect(cb.getStatus().state).toBe('half-open');

        cb.recordFailure('server_error');
        expect(cb.getStatus().state).toBe('open');
        expect(cb.isCallAllowed()).toBe(false);
        resolve();
      }, 20);
    });
  });

  it('records openedAt when transitioning to open', () => {
    const cb = new CircuitBreaker('test-endpoint', testConfig);
    const before = Date.now();

    for (let i = 0; i < 3; i++) cb.recordFailure('server_error');

    const status = cb.getStatus();
    expect(status.openedAt).toBeGreaterThanOrEqual(before);
    expect(status.openedAt).toBeLessThanOrEqual(Date.now());
  });

  it('includes endpointId in status', () => {
    const cb = new CircuitBreaker('anthropic-direct', testConfig);
    expect(cb.getStatus().endpointId).toBe('anthropic-direct');
  });

  it('uses default config when none provided', () => {
    const cb = new CircuitBreaker('default-endpoint');
    // Default threshold is 5
    for (let i = 0; i < 4; i++) cb.recordFailure('server_error');
    expect(cb.getStatus().state).toBe('closed');
    cb.recordFailure('server_error');
    expect(cb.getStatus().state).toBe('open');
  });

  it('DEFAULT_CIRCUIT_BREAKER_CONFIG has sensible defaults', () => {
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5);
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold).toBe(2);
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.cooldownMs).toBe(60_000);
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.monitoredErrorCodes).toContain('server_error');
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.monitoredErrorCodes).toContain('timeout');
  });
});
