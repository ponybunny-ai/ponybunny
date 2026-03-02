/**
 * Command Registry - Slash command registration and parsing
 */

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  group: 'Goal' | 'Work Items' | 'Escalations' | 'System' | 'Navigation' | 'Utility' | 'Other';
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
  // Help
  {
    name: 'help',
    aliases: ['h', '?'],
    group: 'Navigation',
    description: 'Show help information',
    usage: '/help [command]',
    args: [{ name: 'command', required: false, description: 'Command to get help for' }],
  },

  // Goal commands
  {
    name: 'new',
    aliases: ['n', 'create'],
    group: 'Goal',
    description: 'Create a new goal',
    usage: '/new',
  },
  {
    name: 'goals',
    aliases: ['g', 'list'],
    group: 'Goal',
    description: 'List goals',
    usage: '/goals [status]',
    args: [{ name: 'status', required: false, description: 'Filter by status (active/queued/completed)' }],
  },
  {
    name: 'goal',
    group: 'Goal',
    description: 'View goal details',
    usage: '/goal <id>',
    args: [{ name: 'id', required: true, description: 'Goal ID' }],
  },
  {
    name: 'cancel',
    group: 'Goal',
    description: 'Cancel a goal',
    usage: '/cancel <id>',
    args: [{ name: 'id', required: true, description: 'Goal ID to cancel' }],
  },

  // Work item commands
  {
    name: 'workitems',
    aliases: ['wi', 'items'],
    group: 'Work Items',
    description: 'List work items',
    usage: '/workitems [goalId]',
    args: [{ name: 'goalId', required: false, description: 'Filter by goal ID' }],
  },
  {
    name: 'retry',
    aliases: ['rt'],
    group: 'Work Items',
    description: 'Retry a failed work item',
    usage: '/retry <workItemId>',
    args: [{ name: 'workItemId', required: true, description: 'Work item ID to retry' }],
  },

  // Escalation/Approval commands
  {
    name: 'escalations',
    aliases: ['esc', 'e'],
    group: 'Escalations',
    description: 'View pending escalations',
    usage: '/escalations',
  },
  {
    name: 'approvals',
    aliases: ['app', 'a'],
    group: 'Escalations',
    description: 'View pending approvals',
    usage: '/approvals',
  },
  {
    name: 'approve',
    group: 'Escalations',
    description: 'Approve a pending item',
    usage: '/approve <id>',
    args: [{ name: 'id', required: true, description: 'Approval ID' }],
  },
  {
    name: 'reject',
    group: 'Escalations',
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
    group: 'System',
    description: 'Show system status',
    usage: '/status',
  },
  {
    name: 'ping',
    group: 'System',
    description: 'Ping the gateway',
    usage: '/ping',
  },
  {
    name: 'reconnect',
    aliases: ['rc'],
    group: 'System',
    description: 'Reconnect to gateway',
    usage: '/reconnect',
  },
  {
    name: 'refresh',
    aliases: ['rf'],
    group: 'System',
    description: 'Refresh scheduler data or runtime diagnostics',
    usage: '/refresh [runtime] [goalId]',
    args: [
      { name: 'mode', required: false, description: 'Use runtime to run deterministic runtime refresh' },
      { name: 'goalId', required: false, description: 'Optional goal ID for runtime dry run' },
    ],
  },
  {
    name: 'rollout',
    aliases: ['ro'],
    group: 'System',
    description: 'Inspect or update runtime rollout settings',
    usage: '/rollout <status|set|rollback> [key=value ...]',
    args: [
      { name: 'action', required: true, description: 'status, set, or rollback' },
      { name: 'params', required: false, description: 'For set: shadow=<true|false> canary=<0-100> rollback=<true|false>' },
    ],
  },
  {
    name: 'replay',
    aliases: ['rp'],
    group: 'System',
    description: 'Run internal replay diagnostics for a run',
    usage: '/replay <runId> [relatedRunId] [mode=reexecute_tools|facts_only] [allowTools=a,b] [maxAttempts=n] [enableExecution=true|false] [eventsLimit=n] [cursor=x]',
    args: [
      { name: 'runId', required: true, description: 'Primary run ID' },
      { name: 'relatedRunId', required: false, description: 'Optional related run ID' },
      { name: 'options', required: false, description: 'Optional key=value overrides' },
    ],
  },
  {
    name: 'pruneevents',
    aliases: ['pe'],
    group: 'System',
    description: 'Prune internal runtime run events',
    usage: '/pruneevents beforeTsMs=<ms> [runId=<id>] [runIds=a,b] [eventTypes=a,b] [keepLatestPerRun=n]',
    args: [
      { name: 'options', required: true, description: 'Prune key=value options' },
    ],
  },

  // Navigation commands
  {
    name: 'dashboard',
    aliases: ['d', 'home'],
    group: 'Navigation',
    description: 'Go to dashboard view',
    usage: '/dashboard',
  },
  {
    name: 'events',
    aliases: ['ev'],
    group: 'Navigation',
    description: 'Go to events view',
    usage: '/events',
  },

  // Utility commands
  {
    name: 'clear',
    aliases: ['cls', 'c'],
    group: 'Utility',
    description: 'Clear the event log',
    usage: '/clear',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    group: 'Utility',
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
    'Goal Management': commands.filter(c => c.group === 'Goal'),
    'Work Items': commands.filter(c => c.group === 'Work Items'),
    'Escalations & Approvals': commands.filter(c => c.group === 'Escalations'),
    'System': commands.filter(c => c.group === 'System'),
    'Navigation': commands.filter(c => c.group === 'Navigation'),
    'Utility': commands.filter(c => c.group === 'Utility'),
  };
}
