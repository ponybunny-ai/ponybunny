import { ProgressDetector, DEFAULT_PROGRESS_CONFIG } from '../../../src/runtime/react/progress-detector.js';

describe('ProgressDetector', () => {
  let detector: ProgressDetector;

  beforeEach(() => {
    detector = new ProgressDetector();
  });

  it('does not abort when tool calls are present', () => {
    const result = detector.evaluate({ hasToolCalls: true, content: null });
    expect(result.shouldAbort).toBe(false);
  });

  it('does not abort when content is present', () => {
    const result = detector.evaluate({ hasToolCalls: false, content: 'Some analysis' });
    expect(result.shouldAbort).toBe(false);
  });

  it('aborts after maxNoActionIterations empty responses', () => {
    for (let i = 0; i < 2; i++) {
      const r = detector.evaluate({ hasToolCalls: false, content: null });
      expect(r.shouldAbort).toBe(false);
    }

    const result = detector.evaluate({ hasToolCalls: false, content: null });
    expect(result.shouldAbort).toBe(true);
    expect(result.reason).toBe('no_action');
    expect(result.detail).toContain('3');
  });

  it('resets no-action count when a tool call appears', () => {
    detector.evaluate({ hasToolCalls: false, content: null });
    detector.evaluate({ hasToolCalls: false, content: null });
    // Reset via tool call
    detector.evaluate({ hasToolCalls: true, content: null });
    // Start counting again
    detector.evaluate({ hasToolCalls: false, content: null });
    detector.evaluate({ hasToolCalls: false, content: null });

    const result = detector.evaluate({ hasToolCalls: false, content: null });
    // Should abort — 3 consecutive after reset
    expect(result.shouldAbort).toBe(true);
  });

  it('detects stuck loop (repeated identical content without tool calls)', () => {
    detector.evaluate({ hasToolCalls: false, content: 'I am stuck' });
    const result = detector.evaluate({ hasToolCalls: false, content: 'I am stuck' });

    expect(result.shouldAbort).toBe(true);
    expect(result.reason).toBe('stuck_loop');
  });

  it('does not flag as stuck when tool calls accompany repeated content', () => {
    detector.evaluate({ hasToolCalls: false, content: 'Same text' });
    const result = detector.evaluate({ hasToolCalls: true, content: 'Same text' });

    expect(result.shouldAbort).toBe(false);
  });

  it('does not flag as stuck when content changes', () => {
    detector.evaluate({ hasToolCalls: false, content: 'Version 1' });
    const result = detector.evaluate({ hasToolCalls: false, content: 'Version 2' });

    expect(result.shouldAbort).toBe(false);
  });

  it('respects custom maxNoActionIterations', () => {
    // 1 empty response should abort with threshold = 1
    const result = detector.evaluate(
      { hasToolCalls: false, content: null },
      { maxNoActionIterations: 1 }
    );
    expect(result.shouldAbort).toBe(true);
  });

  it('reset clears state', () => {
    detector.evaluate({ hasToolCalls: false, content: null });
    detector.evaluate({ hasToolCalls: false, content: null });
    detector.reset();

    const result = detector.evaluate({ hasToolCalls: false, content: null });
    expect(result.shouldAbort).toBe(false); // Reset counter, not at threshold yet
  });

  it('DEFAULT_PROGRESS_CONFIG has maxNoActionIterations of 3', () => {
    expect(DEFAULT_PROGRESS_CONFIG.maxNoActionIterations).toBe(3);
  });
});
