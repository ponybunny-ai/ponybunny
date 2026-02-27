import {
  DeterministicRuntimeErrorCodes,
  createInternalApiSkeletonResponse,
} from '../../src/deterministic-runtime/index.js';

describe('deterministic runtime internal api skeleton', () => {
  it('exports deterministic runtime error codes for M0 contracts', () => {
    expect(DeterministicRuntimeErrorCodes.ERR_PLAN_SCHEMA_INVALID).toBe('ERR_PLAN_SCHEMA_INVALID');
    expect(DeterministicRuntimeErrorCodes.ERR_RUNTIME_INTERNAL).toBe('ERR_RUNTIME_INTERNAL');
  });

  it('creates stable internal API skeleton responses', () => {
    const response = createInternalApiSkeletonResponse({ runId: 'run-123' });

    expect(response).toEqual({
      ok: true,
      phase: 'm0-skeleton',
      payload: { runId: 'run-123' },
    });
  });
});
