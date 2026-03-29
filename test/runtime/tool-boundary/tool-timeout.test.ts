import {
  DEFAULT_TOOL_TIMEOUT_CONFIG,
  getTimeoutForRisk,
  withToolTimeout,
  type ToolRiskLevel,
  type ToolTimeoutConfig,
} from '../../../src/runtime/tool-boundary/tool-timeout.js';

describe('getTimeoutForRisk', () => {
  it('returns correct timeout for each risk level', () => {
    const levels: ToolRiskLevel[] = ['safe', 'moderate', 'dangerous', 'critical'];
    for (const level of levels) {
      expect(getTimeoutForRisk(level)).toBe(
        DEFAULT_TOOL_TIMEOUT_CONFIG.riskLevelTimeouts[level],
      );
    }
  });

  it('returns default timeout for undefined risk level', () => {
    expect(getTimeoutForRisk(undefined)).toBe(
      DEFAULT_TOOL_TIMEOUT_CONFIG.defaultTimeoutMs,
    );
  });

  it('uses custom config when provided', () => {
    const custom: ToolTimeoutConfig = {
      defaultTimeoutMs: 5_000,
      riskLevelTimeouts: {
        safe: 1_000,
        moderate: 2_000,
        dangerous: 3_000,
        critical: 4_000,
      },
    };
    expect(getTimeoutForRisk('safe', custom)).toBe(1_000);
    expect(getTimeoutForRisk(undefined, custom)).toBe(5_000);
  });
});

describe('withToolTimeout', () => {
  it('returns result on success', async () => {
    const outcome = await withToolTimeout(async (_signal) => 'hello', 1_000);
    expect(outcome).toEqual({ result: 'hello', timedOut: false });
  });

  it('returns timedOut on timeout', async () => {
    const outcome = await withToolTimeout(
      async (signal) =>
        new Promise((_resolve, reject) => {
          const id = setTimeout(() => _resolve('late'), 5_000);
          signal.addEventListener('abort', () => {
            clearTimeout(id);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
      50,
    );
    expect(outcome).toEqual({ result: undefined, timedOut: true });
  });

  it('propagates non-timeout errors', async () => {
    await expect(
      withToolTimeout(async (_signal) => {
        throw new Error('boom');
      }, 1_000),
    ).rejects.toThrow('boom');
  });

  it('clears timer on success (no leaked timers)', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    await withToolTimeout(async (_signal) => 42, 10_000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('clears timer on error', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    try {
      await withToolTimeout(async (_signal) => {
        throw new Error('fail');
      }, 10_000);
    } catch {
      // expected
    }
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('passes AbortSignal to the function', async () => {
    let receivedSignal: AbortSignal | undefined;
    await withToolTimeout(async (signal) => {
      receivedSignal = signal;
      return 'ok';
    }, 1_000);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal!.aborted).toBe(false);
  });
});
