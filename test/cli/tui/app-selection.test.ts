import { resolveInitialAgentIndex } from '../../../src/cli/tui/utils/agent-selection.js';

describe('resolveInitialAgentIndex', () => {
  it('returns runtime main agent index when present', () => {
    const index = resolveInitialAgentIndex(
      [{ id: 'guard' }, { id: 'lead' }, { id: 'planning' }],
      'lead',
      0
    );

    expect(index).toBe(1);
  });

  it('falls back to current index when runtime main agent is missing', () => {
    const index = resolveInitialAgentIndex(
      [{ id: 'guard' }, { id: 'lead' }, { id: 'planning' }],
      'missing',
      2
    );

    expect(index).toBe(2);
  });

  it('normalizes out-of-range current index', () => {
    const index = resolveInitialAgentIndex(
      [{ id: 'guard' }, { id: 'lead' }, { id: 'planning' }],
      null,
      5
    );

    expect(index).toBe(2);
  });

  it('returns zero when no agents are available', () => {
    const index = resolveInitialAgentIndex([], 'lead', 4);

    expect(index).toBe(0);
  });
});
