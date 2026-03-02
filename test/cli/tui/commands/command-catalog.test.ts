import { buildCommandCatalogRows, buildCommandMatches, getCommandCatalogCommandRows } from '../../../../src/cli/tui/commands/command-catalog.js';
import { commands } from '../../../../src/cli/tui/commands/registry.js';

describe('command catalog', () => {
  it('returns full command set when query is empty', () => {
    const rows = buildCommandCatalogRows('', 'alpha');
    const commandRows = getCommandCatalogCommandRows(rows);
    expect(commandRows.length).toBe(commands.length);
  });

  it('keeps startsWith matches first for non-empty query', () => {
    const matched = buildCommandMatches('re');
    expect(matched.length).toBeGreaterThan(0);

    const startsWithCount = matched.filter((cmd) => cmd.name.startsWith('re')).length;
    const firstNonStartsWith = matched.findIndex((cmd) => !cmd.name.startsWith('re'));
    if (firstNonStartsWith !== -1) {
      expect(firstNonStartsWith).toBeGreaterThanOrEqual(startsWithCount);
    }
  });

  it('uses command.group metadata for grouping rows', () => {
    const rows = buildCommandCatalogRows('', 'group');
    const commandRows = getCommandCatalogCommandRows(rows);

    commandRows.forEach((row) => {
      expect(row.group).toBe(row.command.group);
    });
  });
});
