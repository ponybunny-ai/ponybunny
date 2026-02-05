/**
 * Command Handlers - Execute slash commands
 */

import type { AppContextValue } from '../context/app-context.js';
import type { GatewayContextValue } from '../context/gateway-context.js';
import { parseCommand, findCommand, type ParsedCommand } from './registry.js';

export interface CommandContext {
  app: AppContextValue;
  gateway: GatewayContextValue;
  exit: () => void;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  error?: string;
}

type CommandHandler = (
  cmd: ParsedCommand,
  ctx: CommandContext
) => Promise<CommandResult> | CommandResult;

const handlers: Record<string, CommandHandler> = {
  // Display mode commands
  expert: (_cmd, ctx) => {
    ctx.app.setDisplayMode('expert');
    return { success: true, message: 'Switched to expert mode' };
  },

  simple: (_cmd, ctx) => {
    ctx.app.setDisplayMode('simple');
    return { success: true, message: 'Switched to simple mode' };
  },

  // Help command
  help: (_cmd, ctx) => {
    ctx.app.setView('help');
    return { success: true };
  },

  // Goal commands
  new: (_cmd, ctx) => {
    ctx.app.openModal('goal-create');
    return { success: true };
  },

  goals: (_cmd, ctx) => {
    ctx.app.setView('goals');
    return { success: true };
  },

  goal: async (cmd, ctx) => {
    const [goalId] = cmd.args;
    if (!goalId) {
      return { success: false, error: 'Goal ID is required. Usage: /goal <id>' };
    }
    ctx.app.selectGoal(goalId);
    ctx.app.setView('goals');
    return { success: true };
  },

  cancel: async (cmd, ctx) => {
    const [goalId] = cmd.args;
    if (!goalId) {
      return { success: false, error: 'Goal ID is required. Usage: /cancel <id>' };
    }

    ctx.app.openModal('confirm', {
      title: 'Cancel Goal',
      message: `Are you sure you want to cancel goal ${goalId}?`,
      onConfirm: async () => {
        try {
          const client = ctx.gateway.client;
          if (client) {
            await client.cancelGoal(goalId);
            ctx.app.addEvent('goal.cancelled', { goalId });
          }
        } catch (err) {
          ctx.app.addEvent('error', { message: (err as Error).message });
        }
      },
      confirmLabel: 'cancel',
      cancelLabel: 'keep',
    });
    return { success: true };
  },

  // Work item commands
  workitems: async (cmd, ctx) => {
    const [goalId] = cmd.args;
    try {
      const client = ctx.gateway.client;
      if (client) {
        const result = await client.listWorkItems(goalId ? { goalId } : undefined);
        ctx.app.setWorkItems(result.workItems);
        ctx.app.addEvent('workitems.loaded', { count: result.workItems.length });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true };
  },

  // Escalation commands
  escalations: (_cmd, ctx) => {
    const escalations = ctx.app.state.escalations;
    if (escalations.length > 0) {
      ctx.app.openModal('escalation', { escalationId: escalations[0].id });
    } else {
      return { success: true, message: 'No pending escalations' };
    }
    return { success: true };
  },

  approvals: (_cmd, ctx) => {
    // For now, show escalations view
    ctx.app.setView('dashboard');
    return { success: true, message: 'Showing pending approvals on dashboard' };
  },

  approve: async (cmd, ctx) => {
    const [id] = cmd.args;
    if (!id) {
      return { success: false, error: 'Approval ID is required. Usage: /approve <id>' };
    }

    try {
      const client = ctx.gateway.client;
      if (client) {
        await client.resolveEscalation(id, { action: 'skip' });
        ctx.app.removeEscalation(id);
        ctx.app.addEvent('escalation.approved', { id });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true, message: `Approved ${id}` };
  },

  reject: async (cmd, ctx) => {
    const [id, ...reasonParts] = cmd.args;
    if (!id) {
      return { success: false, error: 'Approval ID is required. Usage: /reject <id> [reason]' };
    }

    const reason = reasonParts.join(' ') || 'Rejected by user';

    try {
      const client = ctx.gateway.client;
      if (client) {
        await client.resolveEscalation(id, {
          action: 'skip',
          data: { reason },
        });
        ctx.app.removeEscalation(id);
        ctx.app.addEvent('escalation.rejected', { id, reason });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true, message: `Rejected ${id}` };
  },

  // System commands
  status: async (_cmd, ctx) => {
    const status = ctx.gateway.connectionStatus;
    const goalCount = ctx.app.state.goals.length;
    const escalationCount = ctx.app.state.escalations.length;

    ctx.app.addEvent('system.status', {
      connection: status,
      goals: goalCount,
      escalations: escalationCount,
      url: ctx.gateway.url,
    });
    return {
      success: true,
      message: `Connection: ${status}, Goals: ${goalCount}, Escalations: ${escalationCount}`
    };
  },

  ping: async (_cmd, ctx) => {
    try {
      const client = ctx.gateway.client;
      if (client) {
        const start = Date.now();
        await client.ping();
        const latency = Date.now() - start;
        ctx.app.addEvent('system.ping', { latency });
        return { success: true, message: `Pong! (${latency}ms)` };
      }
      return { success: false, error: 'Not connected to gateway' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  reconnect: (_cmd, ctx) => {
    ctx.gateway.disconnect();
    ctx.gateway.connect();
    ctx.app.addEvent('system.reconnect', {});
    return { success: true, message: 'Reconnecting...' };
  },

  // Navigation commands
  dashboard: (_cmd, ctx) => {
    ctx.app.setView('dashboard');
    return { success: true };
  },

  events: (_cmd, ctx) => {
    ctx.app.setView('events');
    return { success: true };
  },

  // Utility commands
  clear: (_cmd, ctx) => {
    ctx.app.clearEvents();
    return { success: true, message: 'Events cleared' };
  },

  exit: (_cmd, ctx) => {
    ctx.exit();
    return { success: true };
  },
};

// Alias mappings
const aliasMap: Record<string, string> = {
  h: 'help',
  '?': 'help',
  n: 'new',
  create: 'new',
  g: 'goals',
  list: 'goals',
  wi: 'workitems',
  items: 'workitems',
  esc: 'escalations',
  e: 'escalations',
  app: 'approvals',
  a: 'approvals',
  s: 'status',
  rc: 'reconnect',
  d: 'dashboard',
  home: 'dashboard',
  ev: 'events',
  cls: 'clear',
  c: 'clear',
  quit: 'exit',
  q: 'exit',
};

/**
 * Execute a command
 */
export async function executeCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const parsed = parseCommand(input);

  if (!parsed) {
    return { success: false, error: 'Invalid command format' };
  }

  const cmdDef = findCommand(parsed.name);
  if (!cmdDef) {
    return { success: false, error: `Unknown command: ${parsed.name}` };
  }

  // Resolve alias to canonical name
  const canonicalName = aliasMap[parsed.name] || parsed.name;
  const handler = handlers[canonicalName];

  if (!handler) {
    return { success: false, error: `No handler for command: ${canonicalName}` };
  }

  try {
    return await handler(parsed, ctx);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Handle natural language input (non-command)
 * Directly creates a goal from the input text
 */
export async function handleNaturalInput(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const client = ctx.gateway.client;
  if (!client) {
    return { success: false, error: 'Not connected to gateway' };
  }

  const isSimpleMode = ctx.app.state.displayMode === 'simple';
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // In simple mode, add a message to track progress
  if (isSimpleMode) {
    ctx.app.addSimpleMessage({
      id: messageId,
      input,
      status: 'pending',
      timestamp: Date.now(),
    });
  }

  try {
    ctx.app.setActivityStatus('Creating goal...');

    if (isSimpleMode) {
      ctx.app.updateSimpleMessage(messageId, {
        status: 'processing',
        statusText: 'Creating task...',
      });
    }

    // Create goal directly from natural language input
    const goal = await client.submitGoal({
      title: input.length > 60 ? input.slice(0, 60) + '...' : input,
      description: input,
      success_criteria: [{
        description: 'Task completed as described',
        type: 'heuristic',
        verification_method: 'human review',
        required: true,
      }],
      priority: 50,
    });

    ctx.app.addGoal(goal);
    ctx.app.addEvent('goal.created', { goalId: goal.id, title: goal.title });
    ctx.app.setActivityStatus('idle');

    if (isSimpleMode) {
      ctx.app.updateSimpleMessage(messageId, {
        status: 'processing',
        statusText: 'Executing...',
        goalId: goal.id,
      });
    }

    return { success: true, message: `Goal created: ${goal.title}` };
  } catch (err) {
    ctx.app.setActivityStatus('idle');
    const errorMessage = (err as Error).message;

    if (isSimpleMode) {
      ctx.app.updateSimpleMessage(messageId, {
        status: 'failed',
        error: errorMessage,
      });
    }

    return { success: false, error: `Failed to create goal: ${errorMessage}` };
  }
}
