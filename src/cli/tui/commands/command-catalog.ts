import { commands, type CommandDefinition } from './registry.js';

export type CommandCatalogMode = 'alpha' | 'group';

export type CommandCatalogGroupRow = {
  type: 'group';
  label: string;
  key: string;
};

export type CommandCatalogCommandRow = {
  type: 'command';
  command: CommandDefinition;
  group: string;
};

export type CommandCatalogRow = CommandCatalogGroupRow | CommandCatalogCommandRow;

const GROUP_ORDER = [
  'Goal',
  'Work Items',
  'Escalations',
  'System',
  'Navigation',
  'Utility',
  'Other',
] as const;

export function inferCommandGroup(command: CommandDefinition): string {
  return command.group || 'Other';
}

export function buildCommandMatches(query: string): CommandDefinition[] {
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) {
    return [...commands].sort((a, b) => a.name.localeCompare(b.name));
  }

  const matched = commands.filter((cmd) => {
    if (cmd.name.includes(lowerQuery)) return true;
    return cmd.aliases?.some((alias) => alias.includes(lowerQuery)) ?? false;
  });

  return matched.sort((a, b) => {
    const aStarts = a.name.startsWith(lowerQuery);
    const bStarts = b.name.startsWith(lowerQuery);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function buildCommandCatalogRows(query: string, mode: CommandCatalogMode): CommandCatalogRow[] {
  const matched = buildCommandMatches(query);
  if (mode === 'alpha') {
    return matched.map((command) => ({
      type: 'command',
      command,
      group: inferCommandGroup(command),
    }));
  }

  const grouped = new Map<string, CommandDefinition[]>();
  for (const command of matched) {
    const group = inferCommandGroup(command);
    const list = grouped.get(group) || [];
    list.push(command);
    grouped.set(group, list);
  }

  const rows: CommandCatalogRow[] = [];
  for (const group of GROUP_ORDER) {
    const commandsInGroup = grouped.get(group);
    if (!commandsInGroup || commandsInGroup.length === 0) continue;
    rows.push({ type: 'group', label: group, key: `group-${group}` });
    for (const command of commandsInGroup) {
      rows.push({ type: 'command', command, group });
    }
  }

  return rows;
}

export function getCommandCatalogCommandRows(rows: CommandCatalogRow[]): CommandCatalogCommandRow[] {
  return rows.filter((row): row is CommandCatalogCommandRow => row.type === 'command');
}
