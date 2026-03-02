import { projectRowsForWindow } from '../../../../src/cli/tui/components/layout/input-suggestion-window.js';
import { buildSuggestionRows } from '../../../../src/cli/tui/components/layout/input-suggestion-state.js';
import { commands } from '../../../../src/cli/tui/commands/registry.js';

describe('input suggestion window projection', () => {
  it('limits alpha mode rows by command window', () => {
    const rows = buildSuggestionRows(commands, '', 'alpha');
    const visible = projectRowsForWindow({
      rows,
      mode: 'alpha',
      commandOffset: 0,
      commandLimit: 4,
    });

    const commandRows = visible.filter((row) => row.type === 'command');
    expect(commandRows.length).toBe(4);
  });

  it('keeps all rows in group mode', () => {
    const rows = buildSuggestionRows(commands, '', 'group');
    const visible = projectRowsForWindow({
      rows,
      mode: 'group',
      commandOffset: 0,
      commandLimit: 4,
    });

    const visibleCommands = visible.filter((row) => row.type === 'command');
    expect(visibleCommands.length).toBe(4);
    expect(visible[0]?.type).toBe('group');
  });

  it('group mode never projects a standalone group header without command rows', () => {
    const rows = buildSuggestionRows(commands, '', 'group');
    const visible = projectRowsForWindow({
      rows,
      mode: 'group',
      commandOffset: 3,
      commandLimit: 2,
    });

    let seenGroup = false;
    visible.forEach((row, index) => {
      if (row.type === 'group') {
        seenGroup = true;
        const next = visible[index + 1];
        expect(next?.type).toBe('command');
      }
    });

    expect(seenGroup).toBe(true);
  });

  it('emits each group header at most once per contiguous projected section', () => {
    const rows = buildSuggestionRows(commands, '', 'group');
    const visible = projectRowsForWindow({
      rows,
      mode: 'group',
      commandOffset: 0,
      commandLimit: 12,
    });

    const groupKeys = visible
      .filter((row): row is Extract<(typeof visible)[number], { type: 'group' }> => row.type === 'group')
      .map((row) => row.key);

    const unique = new Set(groupKeys);
    expect(groupKeys.length).toBe(unique.size);
  });
});
