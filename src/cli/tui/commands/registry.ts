/**
 * Command Registry - Slash command registration and parsing
 */

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  args?: {
    name: string;
    required?: boolean;
    description?: string;
  }[];
}

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export const commands: CommandDefinition[] = [
  // Display mode commands
  {
    name: 'expert',
    description: 'Switch to expert mode (full UI)',
    usage: '/expert',
  },
  {
    name: 'simple',
    description: 'Switch to simple mode (chat UI)',
    usage: '/simple',
  },

  // Help
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show help information',
    usage: '/help [command]',
    args: [{ name: 'command', required: false, description: 'Command to get help for' }],
  },

  // Goal commands
  {
    name: 'new',
    aliases: ['n', 'create'],
    description: 'Create a new goal',
    usage: '/new',
  },
  {
    name: 'goals',
    aliases: ['g', 'list'],
    description: 'List goals',
    usage: '/goals [status]',
    args: [{ name: 'status', required: false, description: 'Filter by status (active/queued/completed)' }],
  },
  {
    name: 'goal',
    description: 'View goal details',
    usage: '/goal <id>',
    args: [{ name: 'id', required: true, description: 'Goal ID' }],
  },
  {
    name: 'cancel',
    description: 'Cancel a goal',
    usage: '/cancel <id>',
    args: [{ name: 'id', required: true, description: 'Goal ID to cancel' }],
  },

  // Work item commands
  {
    name: 'workitems',
    aliases: ['wi', 'items'],
    description: 'List work items',
    usage: '/workitems [goalId]',
    args: [{ name: 'goalId', required: false, description: 'Filter by goal ID' }],
  },

  // Escalation/Approval commands
  {
    name: 'escalations',
    aliases: ['esc', 'e'],
    description: 'View pending escalations',
    usage: '/escalations',
  },
  {
    name: 'approvals',
    aliases: ['app', 'a'],
    description: 'View pending approvals',
    usage: '/approvals',
  },
  {
    name: 'approve',
    description: 'Approve a pending item',
    usage: '/approve <id>',
    args: [{ name: 'id', required: true, description: 'Approval ID' }],
  },
  {
    name: 'reject',
    description: 'Reject a pending item',
    usage: '/reject <id> [reason]',
    args: [
      { name: 'id', required: true, description: 'Approval ID' },
      { name: 'reason', required: false, description: 'Rejection reason' },
    ],
  },

  // System commands
  {
    name: 'status',
    aliases: ['s'],
    description: 'Show system status',
    usage: '/status',
  },
  {
    name: 'ping',
    description: 'Ping the gateway',
    usage: '/ping',
  },
  {
    name: 'reconnect',
    aliases: ['rc'],
    description: 'Reconnect to gateway',
    usage: '/reconnect',
  },

  // Navigation commands
  {
    name: 'dashboard',
    aliases: ['d', 'home'],
    description: 'Go to dashboard view',
    usage: '/dashboard',
  },
  {
    name: 'events',
    aliases: ['ev'],
    description: 'Go to events view',
    usage: '/events',
  },

  // Utility commands
  {
    name: 'clear',
    aliases: ['cls', 'c'],
    description: 'Clear the event log',
    usage: '/clear',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the application',
    usage: '/exit',
  },
];

/**
 * Parse a command string into a ParsedCommand
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();

  if (!name) {
    return null;
  }

  return {
    name,
    args: parts.slice(1),
    raw: trimmed,
  };
}

/**
 * Find a command definition by name or alias
 */
export function findCommand(name: string): CommandDefinition | undefined {
  const lowerName = name.toLowerCase();
  return commands.find(
    cmd => cmd.name === lowerName || cmd.aliases?.includes(lowerName)
  );
}

/**
 * Check if input is a command
 */
export function isCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * Get all commands grouped by category
 */
export function getCommandsByCategory(): Record<string, CommandDefinition[]> {
  return {
    'Display Mode': commands.filter(c =>
      ['expert', 'simple'].includes(c.name)
    ),
    'Goal Management': commands.filter(c =>
      ['new', 'goals', 'goal', 'cancel'].includes(c.name)
    ),
    'Work Items': commands.filter(c =>
      ['workitems'].includes(c.name)
    ),
    'Escalations & Approvals': commands.filter(c =>
      ['escalations', 'approvals', 'approve', 'reject'].includes(c.name)
    ),
    'System': commands.filter(c =>
      ['status', 'ping', 'reconnect'].includes(c.name)
    ),
    'Navigation': commands.filter(c =>
      ['dashboard', 'events', 'help'].includes(c.name)
    ),
    'Utility': commands.filter(c =>
      ['clear', 'exit'].includes(c.name)
    ),
  };
}
