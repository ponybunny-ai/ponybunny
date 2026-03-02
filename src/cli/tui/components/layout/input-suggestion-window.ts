import type { SuggestionRow } from './input-suggestion-state.js';

export function projectRowsForWindow(params: {
  rows: SuggestionRow[];
  mode: 'alpha' | 'group';
  commandOffset: number;
  commandLimit: number;
}): SuggestionRow[] {
  const { rows, mode, commandOffset, commandLimit } = params;
  const commandRows = rows.filter((row) => row.type === 'command');
  const visibleNames = new Set(
    commandRows
      .slice(commandOffset, commandOffset + commandLimit)
      .map((row) => row.command.name)
  );

  if (mode === 'alpha') {
    return rows.filter((row) => row.type === 'command' && visibleNames.has(row.command.name));
  }

  const projected: SuggestionRow[] = [];
  let currentGroup: SuggestionRow | null = null;
  let lastEmittedGroupKey: string | null = null;

  for (const row of rows) {
    if (row.type === 'group') {
      currentGroup = row;
      continue;
    }

    if (!visibleNames.has(row.command.name)) {
      continue;
    }

    if (currentGroup) {
      if (lastEmittedGroupKey !== currentGroup.key) {
        projected.push(currentGroup);
        lastEmittedGroupKey = currentGroup.key;
      }
    }

    projected.push(row);
  }

  return projected;
}
