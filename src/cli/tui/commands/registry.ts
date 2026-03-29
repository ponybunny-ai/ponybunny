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
    description: 'Create a new conversation session',
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
    name: 'sessions',
    aliases: ['ss'],
    group: 'Goal',
    description: 'List recent conversation sessions',
    usage: '/sessions [active|archived|--active-only|--archived-only] [limit] [query]',
    args: [
      { name: 'state', required: false, description: 'Filter by lifecycle state' },
      { name: 'flag', required: false, description: '--active-only or --archived-only' },
      { name: 'limit', required: false, description: 'Optional max sessions (default 20)' },
      { name: 'query', required: false, description: 'Optional search query' },
    ],
  },
  {
    name: 'use',
    aliases: ['session'],
    group: 'Goal',
    description: 'Switch active session',
    usage: '/use <sessionId>',
    args: [{ name: 'sessionId', required: true, description: 'Session ID to activate' }],
  },
  {
    name: 'archive-session',
    aliases: ['as'],
    group: 'Goal',
    description: 'Archive a session',
    usage: '/archive-session <sessionId>',
    args: [{ name: 'sessionId', required: true, description: 'Session ID to archive' }],
  },
  {
    name: 'resume-session',
    aliases: ['rs'],
    group: 'Goal',
    description: 'Resume an archived session',
    usage: '/resume-session <sessionId>',
    args: [{ name: 'sessionId', required: true, description: 'Session ID to resume' }],
  },
  {
    name: 'session-history',
    aliases: ['sh'],
    group: 'Goal',
    description: 'Show session conversation history',
    usage: '/session-history [sessionId] [limit] [role] [offset] [previewLines]',
    args: [
      { name: 'sessionId', required: false, description: 'Session ID (defaults to active session)' },
      { name: 'limit', required: false, description: 'Max turns to fetch (default 20)' },
      { name: 'role', required: false, description: 'Filter by role: all|user|assistant|system' },
      { name: 'offset', required: false, description: 'How many newest turns to skip (default 0)' },
      { name: 'previewLines', required: false, description: 'Max preview lines in output (default 8)' },
    ],
  },
  {
    name: 'session-history-clear',
    aliases: ['shc'],
    group: 'Goal',
    description: 'Clear all cached session history previews',
    usage: '/session-history-clear',
  },
  {
    name: 'sessions-reset',
    aliases: ['srst'],
    group: 'Goal',
    description: 'Reset sessions view state (filter/search/sort)',
    usage: '/sessions-reset',
  },
  {
    name: 'sessions-export',
    aliases: ['shex'],
    group: 'Goal',
    description: 'Export current sessions summary to message output',
    usage: '/sessions-export',
  },
  {
    name: 'events-export',
    aliases: ['eex'],
    group: 'Navigation',
    description: 'Export currently filtered events to message output',
    usage: '/events-export [limit]',
    args: [{ name: 'limit', required: false, description: 'Max exported events (default 50)' }],
  },
  {
    name: 'events-reset',
    aliases: ['erst'],
    group: 'Navigation',
    description: 'Reset events view filter/search state',
    usage: '/events-reset',
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
    name: 'channels',
    aliases: ['ch'],
    group: 'System',
    description: 'Show channel routing and adapter health status',
    usage: '/channels',
  },
  {
    name: 'channel-events',
    aliases: ['chev'],
    group: 'System',
    description: 'Replay channel events with optional limit/cursor/prefix',
    usage: '/channel-events [limit] [cursor] [eventPrefix]',
    args: [
      { name: 'limit', required: false, description: 'Max events to fetch (default 50)' },
      { name: 'cursor', required: false, description: 'Pagination cursor returned by previous call' },
      { name: 'eventPrefix', required: false, description: 'Optional event prefix filter' },
    ],
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
    name: 'models',
    aliases: ['modelpicker'],
    group: 'System',
    description: 'Open model selector for new goals',
    usage: '/models',
  },
  {
    name: 'input-mode',
    aliases: ['im'],
    group: 'System',
    description: 'Show or enforce session-first input mode',
    usage: '/input-mode [session-first]',
    args: [{ name: 'mode', required: false, description: 'session-first' }],
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
  {
    name: 'workstream',
    aliases: ['timeline', 'ws'],
    group: 'Navigation',
    description: 'Go to workstream view (timeline/workitems/runs/results)',
    usage: '/workstream',
  },

  // Service management
  {
    name: 'webui',
    aliases: ['web', 'ui'],
    group: 'System',
    description: 'Manage the PonyBunny Web UI (start/stop/status/logs)',
    usage: '/webui <start|stop|status|logs> [--port <port>]',
    args: [{ name: 'subcommand', required: true, description: 'start, stop, status, or logs' }],
  },

  // Harness commands
  {
    name: 'learn',
    aliases: ['kn'],
    group: 'System',
    description: 'Extract knowledge from goals into the global knowledge base',
    usage: '/learn [--goal <goal-id>] [--all] [--dry-run]',
    args: [{ name: 'options', required: false, description: 'Goal ID, --all, or --dry-run' }],
  },
  {
    name: 'failure-analysis',
    aliases: ['fa'],
    group: 'System',
    description: 'Analyze failure patterns across goals',
    usage: '/failure-analysis [--top <n>] [--goal <goal-id>]',
    args: [{ name: 'options', required: false, description: 'Top N or goal filter' }],
  },
  {
    name: 'knowledge',
    aliases: ['kb'],
    group: 'System',
    description: 'Manage the global knowledge base (list, stats, reinforce)',
    usage: '/knowledge <list|stats|reinforce> [options]',
    args: [
      { name: 'subcommand', required: true, description: 'list, stats, or reinforce' },
      { name: 'options', required: false, description: 'Subcommand options (--type, --limit, or knowledge ID)' },
    ],
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
