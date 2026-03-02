import { buildSuggestionRows, getCommandRows } from '../../../../src/cli/tui/components/layout/input-suggestion-state.js';
import { commands } from '../../../../src/cli/tui/commands/registry.js';
import { buildCommandMatches } from '../../../../src/cli/tui/commands/command-catalog.js';

describe('input suggestion state', () => {
  it('returns all commands in alpha mode and keeps alphabetical ordering', () => {
    const rows = buildSuggestionRows(commands, '', 'alpha');
    const commandRows = getCommandRows(rows);

    expect(commandRows.length).toBe(commands.length);
    const names = commandRows.map((row) => row.command.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('returns grouped rows in group mode with all command rows preserved', () => {
    const rows = buildSuggestionRows(commands, '', 'group');
    const commandRows = getCommandRows(rows);

    const groupRows = rows.filter((row) => row.type === 'group');
    expect(groupRows.length).toBeGreaterThan(0);
    expect(commandRows.length).toBe(commands.length);
  });

  it('uses same command source ordering as shared command catalog', () => {
    const query = 're';
    const rows = buildSuggestionRows(commands, query, 'alpha');
    const namesFromSuggestions = getCommandRows(rows).map((row) => row.command.name);
    const namesFromCatalog = buildCommandMatches(query).map((command) => command.name);

    expect(namesFromSuggestions).toEqual(namesFromCatalog);
  });
});
