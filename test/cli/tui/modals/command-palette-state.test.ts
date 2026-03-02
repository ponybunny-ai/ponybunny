import { clampSelectedIndex, nextScrollOffset } from '../../../../src/cli/tui/components/modals/command-palette-state.js';

describe('command palette state helpers', () => {
  it('clamps selected index within filtered range', () => {
    expect(clampSelectedIndex(8, 3)).toBe(2);
    expect(clampSelectedIndex(-1, 3)).toBe(0);
    expect(clampSelectedIndex(1, 3)).toBe(1);
  });

  it('computes scroll offset to keep selection visible', () => {
    expect(nextScrollOffset({ selectedIndex: 0, currentOffset: 0, maxVisible: 5, total: 20 })).toBe(0);
    expect(nextScrollOffset({ selectedIndex: 7, currentOffset: 0, maxVisible: 5, total: 20 })).toBe(3);
    expect(nextScrollOffset({ selectedIndex: 2, currentOffset: 6, maxVisible: 5, total: 20 })).toBe(2);
  });
});
