import { getNextReasoningEffortIndex } from '../../../src/cli/tui/model-variant.js';

describe('model variant index selection', () => {
  it('cycles variant index when reasoning efforts exist', () => {
    expect(getNextReasoningEffortIndex(['minimal', 'low', 'high'], 0)).toBe(1);
    expect(getNextReasoningEffortIndex(['minimal', 'low', 'high'], 2)).toBe(0);
  });

  it('does not change index when no variants or single variant', () => {
    expect(getNextReasoningEffortIndex(undefined, 0)).toBe(0);
    expect(getNextReasoningEffortIndex([], 2)).toBe(2);
    expect(getNextReasoningEffortIndex(['minimal'], 1)).toBe(1);
  });
});
