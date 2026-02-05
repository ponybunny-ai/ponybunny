/**
 * Gateway TUI - Terminal UI connected to the Gateway server
 *
 * This TUI connects to the pony Gateway via WebSocket and provides
 * an interactive interface for managing goals, work items, and viewing
 * system status.
 */

import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { TuiGatewayClient, type GatewayEvent, type GoalSubmitParams } from '../gateway/index.js';
import type { Goal } from '../../work-order/types/index.js';

// ============================================================================
// Types
// ============================================================================

interface Message {
  role: 'user' | 'system' | 'event';
  content: string;
  timestamp: number;
  eventType?: string;
}

interface TuiState {
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  activityStatus: string;
  goals: Goal[];
  selectedGoalId: string | null;
}

interface GatewayTuiProps {
  url?: string;
  token?: string;
}

// ============================================================================
// Slash Commands
// ============================================================================

interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'Show this help message' },
  { name: 'status', description: 'Show gateway status' },
  { name: 'ping', description: 'Ping the gateway' },
  { name: 'goals', description: 'List all goals' },
  { name: 'goal', description: 'Show goal details', usage: '/goal <id>' },
  { name: 'new', description: 'Create a new goal (interactive)' },
  { name: 'cancel', description: 'Cancel a goal', usage: '/cancel <id> [reason]' },
  { name: 'workitems', description: 'List work items', usage: '/workitems [goalId]' },
  { name: 'escalations', description: 'List pending escalations' },
  { name: 'approvals', description: 'List pending approvals' },
  { name: 'approve', description: 'Approve a request', usage: '/approve <id>' },
  { name: 'reject', description: 'Reject a request', usage: '/reject <id> [reason]' },
  { name: 'clear', description: 'Clear the message log' },
  { name: 'exit', description: 'Exit the TUI' },
];

function getHelpText(): string {
  const lines = ['Available Commands:', ''];
  for (const cmd of SLASH_COMMANDS) {
    const usage = cmd.usage || `/${cmd.name}`;
    lines.push(`  ${usage.padEnd(28)} ${cmd.description}`);
  }
  lines.push('');
  lines.push('Keyboard Shortcuts:');
  lines.push('  Ctrl+C / ESC              Exit');
  lines.push('  Ctrl+L                    Clear screen');
  return lines.join('\n');
}

// ============================================================================
// Goal Creation Modal
// ============================================================================

interface GoalCreationState {
  step: 'title' | 'description' | 'criteria' | 'priority' | 'confirm';
  title: string;
  description: string;
  criteria: string[];
  currentCriterion: string;
  priority: number;
}

const GoalCreationModal: React.FC<{
  onSubmit: (params: GoalSubmitParams) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const [state, setState] = useState<GoalCreationState>({
    step: 'title',
    title: '',
    description: '',
    criteria: [],
    currentCriterion: '',
    priority: 50,
  });
  const [input, setInput] = useState('');

  useInput((_char, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSubmit = useCallback(() => {
    switch (state.step) {
      case 'title':
        if (input.trim()) {
          setState(s => ({ ...s, title: input.trim(), step: 'description' }));
          setInput('');
        }
        break;
      case 'description':
        if (input.trim()) {
          setState(s => ({ ...s, description: input.trim(), step: 'criteria' }));
          setInput('');
        }
        break;
      case 'criteria':
        if (input.trim()) {
          if (input.toLowerCase() === 'done') {
            if (state.criteria.length > 0) {
              setState(s => ({ ...s, step: 'priority' }));
            }
          } else {
            setState(s => ({ ...s, criteria: [...s.criteria, input.trim()] }));
          }
          setInput('');
        }
        break;
      case 'priority':
        const priority = parseInt(input, 10);
        if (!isNaN(priority) && priority >= 1 && priority <= 100) {
          setState(s => ({ ...s, priority, step: 'confirm' }));
          setInput('');
        } else if (input.trim() === '') {
          setState(s => ({ ...s, step: 'confirm' }));
          setInput('');
        }
        break;
      case 'confirm':
        if (input.toLowerCase() === 'y' || input.toLowerCase() === 'yes') {
          onSubmit({
            title: state.title,
            description: state.description,
            success_criteria: state.criteria.map(c => ({
              description: c,
              type: 'heuristic' as const,
              verification_method: 'human review',
              required: true,
            })),
            priority: state.priority,
          });
        } else if (input.toLowerCase() === 'n' || input.toLowerCase() === 'no') {
          onCancel();
        }
        setInput('');
        break;
    }
  }, [state, input, onSubmit, onCancel]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">Create New Goal</Text>
      <Text dimColor>Press ESC to cancel</Text>
      <Box marginTop={1} />

      {state.step === 'title' && (
        <>
          <Text>Enter goal title:</Text>
          <Box>
            <Text color="green">➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        </>
      )}

      {state.step === 'description' && (
        <>
          <Text dimColor>Title: {state.title}</Text>
          <Box marginTop={1} />
          <Text>Enter goal description:</Text>
          <Box>
            <Text color="green">➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        </>
      )}

      {state.step === 'criteria' && (
        <>
          <Text dimColor>Title: {state.title}</Text>
          <Text dimColor>Description: {state.description}</Text>
          <Box marginTop={1} />
          <Text>Enter success criteria (type "done" when finished):</Text>
          {state.criteria.map((c, i) => (
            <Text key={i} color="gray">  {i + 1}. {c}</Text>
          ))}
          <Box>
            <Text color="green">➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        </>
      )}

      {state.step === 'priority' && (
        <>
          <Text dimColor>Title: {state.title}</Text>
          <Text dimColor>Criteria: {state.criteria.length} items</Text>
          <Box marginTop={1} />
          <Text>Enter priority (1-100, default 50):</Text>
          <Box>
            <Text color="green">➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        </>
      )}

      {state.step === 'confirm' && (
        <>
          <Text bold>Review Goal:</Text>
          <Text>  Title: {state.title}</Text>
          <Text>  Description: {state.description}</Text>
          <Text>  Priority: {state.priority}</Text>
          <Text>  Success Criteria:</Text>
          {state.criteria.map((c, i) => (
            <Text key={i}>    {i + 1}. {c}</Text>
          ))}
          <Box marginTop={1} />
          <Text>Submit this goal? (y/n)</Text>
          <Box>
            <Text color="green">➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        </>
      )}
    </Box>
  );
};

// ============================================================================
// Goal List View
// ============================================================================

const GoalListView: React.FC<{
  goals: Goal[];
  onSelect: (goal: Goal) => void;
  onCancel: () => void;
}> = ({ goals, onSelect, onCancel }) => {
  useInput((_char, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  if (goals.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
        <Text color="yellow">No goals found</Text>
        <Text dimColor>Press ESC to go back</Text>
      </Box>
    );
  }

  const items = goals.map(g => ({
    label: `[${g.status}] ${g.title}`,
    value: g,
  }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">Goals ({goals.length})</Text>
      <Text dimColor>Press ESC to cancel, Enter to select</Text>
      <Box marginTop={1} />
      <SelectInput
        items={items}
        onSelect={(item) => onSelect(item.value)}
        limit={10}
      />
    </Box>
  );
};

// ============================================================================
// Main TUI Component
// ============================================================================

const GatewayTui: React.FC<GatewayTuiProps> = ({ url, token }) => {
  const { exit } = useApp();
  const clientRef = useRef<TuiGatewayClient | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [state, setState] = useState<TuiState>({
    connectionStatus: 'connecting',
    activityStatus: 'idle',
    goals: [],
    selectedGoalId: null,
  });

  // Modal states
  const [showGoalCreation, setShowGoalCreation] = useState(false);
  const [showGoalList, setShowGoalList] = useState(false);

  // Add a message to the log
  const addMessage = useCallback((role: Message['role'], content: string, eventType?: string) => {
    setMessages(prev => [...prev, {
      role,
      content,
      timestamp: Date.now(),
      eventType,
    }]);
  }, []);

  // Initialize client
  useEffect(() => {
    const client = new TuiGatewayClient({ url, token });
    clientRef.current = client;

    client.onConnected = () => {
      setState(s => ({ ...s, connectionStatus: 'connected' }));
      addMessage('system', `Connected to gateway at ${client.url}`);
    };

    client.onDisconnected = (reason) => {
      setState(s => ({ ...s, connectionStatus: 'disconnected' }));
      addMessage('system', `Disconnected: ${reason}`);
    };

    client.onEvent = (evt: GatewayEvent) => {
      addMessage('event', `[${evt.event}] ${JSON.stringify(evt.data)}`, evt.event);
    };

    client.onError = (error) => {
      addMessage('system', `Error: ${error.message}`);
    };

    client.start();

    return () => {
      client.stop();
    };
  }, [url, token, addMessage]);

  // Handle slash commands
  const handleCommand = useCallback(async (raw: string) => {
    const client = clientRef.current;
    if (!client) return;

    const parts = raw.slice(1).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';
    const args = parts.slice(1);

    addMessage('user', raw);

    try {
      switch (cmd) {
        case 'help':
          addMessage('system', getHelpText());
          break;

        case 'exit':
        case 'quit':
          exit();
          break;

        case 'clear':
          setMessages([]);
          break;

        case 'ping': {
          setState(s => ({ ...s, activityStatus: 'pinging...' }));
          const result = await client.ping();
          addMessage('system', `Pong! Server time: ${new Date(result.pong).toISOString()}`);
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'status': {
          setState(s => ({ ...s, activityStatus: 'fetching status...' }));
          try {
            const stats = await client.getStats();
            const lines = [
              'Gateway Status:',
              `  Running: ${stats.isRunning}`,
              `  Address: ${stats.address || 'N/A'}`,
              `  Connections: ${stats.connections?.total || 0} (${stats.connections?.authenticated || 0} authenticated)`,
              `  Daemon: ${stats.daemonConnected ? 'connected' : 'disconnected'}`,
              `  Scheduler: ${stats.schedulerConnected ? 'connected' : 'disconnected'}`,
            ];
            addMessage('system', lines.join('\n'));
          } catch (err) {
            addMessage('system', `Status unavailable: ${(err as Error).message}`);
          }
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'goals': {
          setState(s => ({ ...s, activityStatus: 'loading goals...' }));
          const result = await client.listGoals();
          setState(s => ({ ...s, goals: result.goals, activityStatus: 'idle' }));
          if (result.goals.length === 0) {
            addMessage('system', 'No goals found. Use /new to create one.');
          } else {
            setShowGoalList(true);
          }
          break;
        }

        case 'goal': {
          if (!args[0]) {
            addMessage('system', 'Usage: /goal <id>');
            break;
          }
          setState(s => ({ ...s, activityStatus: 'loading goal...' }));
          const goal = await client.getGoalStatus(args[0]);
          const lines = [
            `Goal: ${goal.title}`,
            `  ID: ${goal.id}`,
            `  Status: ${goal.status}`,
            `  Priority: ${goal.priority}`,
            `  Description: ${goal.description}`,
            `  Created: ${new Date(goal.created_at).toLocaleString()}`,
            `  Success Criteria:`,
            ...goal.success_criteria.map((c, i) => `    ${i + 1}. ${c.description}`),
          ];
          addMessage('system', lines.join('\n'));
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'new':
          setShowGoalCreation(true);
          break;

        case 'cancel': {
          if (!args[0]) {
            addMessage('system', 'Usage: /cancel <goalId> [reason]');
            break;
          }
          setState(s => ({ ...s, activityStatus: 'cancelling...' }));
          const reason = args.slice(1).join(' ') || undefined;
          await client.cancelGoal(args[0], reason);
          addMessage('system', `Goal ${args[0]} cancelled`);
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'workitems': {
          setState(s => ({ ...s, activityStatus: 'loading work items...' }));
          const result = await client.listWorkItems(args[0] ? { goalId: args[0] } : undefined);
          if (result.workItems.length === 0) {
            addMessage('system', 'No work items found.');
          } else {
            const lines = [`Work Items (${result.total}):`];
            for (const wi of result.workItems) {
              lines.push(`  [${wi.status}] ${wi.title} (${wi.id})`);
            }
            addMessage('system', lines.join('\n'));
          }
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'escalations': {
          setState(s => ({ ...s, activityStatus: 'loading escalations...' }));
          try {
            const result = await client.listEscalations();
            if (!result.escalations || result.escalations.length === 0) {
              addMessage('system', 'No pending escalations.');
            } else {
              addMessage('system', `Escalations: ${JSON.stringify(result.escalations, null, 2)}`);
            }
          } catch (err) {
            addMessage('system', `Failed to load escalations: ${(err as Error).message}`);
          }
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'approvals': {
          setState(s => ({ ...s, activityStatus: 'loading approvals...' }));
          try {
            const result = await client.listApprovals();
            if (!result.approvals || result.approvals.length === 0) {
              addMessage('system', 'No pending approvals.');
            } else {
              addMessage('system', `Approvals: ${JSON.stringify(result.approvals, null, 2)}`);
            }
          } catch (err) {
            addMessage('system', `Failed to load approvals: ${(err as Error).message}`);
          }
          setState(s => ({ ...s, activityStatus: 'idle' }));
          break;
        }

        case 'approve': {
          if (!args[0]) {
            addMessage('system', 'Usage: /approve <id>');
            break;
          }
          await client.approve(args[0]);
          addMessage('system', `Approved: ${args[0]}`);
          break;
        }

        case 'reject': {
          if (!args[0]) {
            addMessage('system', 'Usage: /reject <id> [reason]');
            break;
          }
          const reason = args.slice(1).join(' ') || undefined;
          await client.reject(args[0], reason);
          addMessage('system', `Rejected: ${args[0]}`);
          break;
        }

        default:
          addMessage('system', `Unknown command: /${cmd}\nType /help for available commands.`);
      }
    } catch (err) {
      addMessage('system', `Error: ${(err as Error).message}`);
      setState(s => ({ ...s, activityStatus: 'error' }));
    }
  }, [addMessage, exit]);

  // Handle input submission
  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setInput('');

    if (trimmed.startsWith('/')) {
      handleCommand(trimmed);
    } else {
      // Non-command input - could be used for chat in the future
      addMessage('user', trimmed);
      addMessage('system', 'Use /help to see available commands.');
    }
  }, [input, handleCommand, addMessage]);

  // Handle goal creation
  const handleGoalSubmit = useCallback(async (params: GoalSubmitParams) => {
    const client = clientRef.current;
    if (!client) return;

    setShowGoalCreation(false);
    setState(s => ({ ...s, activityStatus: 'creating goal...' }));

    try {
      const goal = await client.submitGoal(params);
      addMessage('system', `Goal created: ${goal.title} (${goal.id})`);
    } catch (err) {
      addMessage('system', `Failed to create goal: ${(err as Error).message}`);
    }

    setState(s => ({ ...s, activityStatus: 'idle' }));
  }, [addMessage]);

  // Handle goal selection from list
  const handleGoalSelect = useCallback((goal: Goal) => {
    setShowGoalList(false);
    const lines = [
      `Goal: ${goal.title}`,
      `  ID: ${goal.id}`,
      `  Status: ${goal.status}`,
      `  Priority: ${goal.priority}`,
      `  Description: ${goal.description}`,
    ];
    addMessage('system', lines.join('\n'));
  }, [addMessage]);

  // Keyboard shortcuts
  useInput((char, key) => {
    if (key.escape || (key.ctrl && char === 'c')) {
      if (showGoalCreation) {
        setShowGoalCreation(false);
      } else if (showGoalList) {
        setShowGoalList(false);
      } else {
        exit();
      }
    }
    if (key.ctrl && char === 'l') {
      setMessages([]);
    }
  });

  // Connection status color
  const statusColor = {
    connecting: 'yellow',
    connected: 'green',
    disconnected: 'red',
    error: 'red',
  }[state.connectionStatus] as 'yellow' | 'green' | 'red';

  // Render modals
  if (showGoalCreation) {
    return (
      <GoalCreationModal
        onSubmit={handleGoalSubmit}
        onCancel={() => setShowGoalCreation(false)}
      />
    );
  }

  if (showGoalList) {
    return (
      <GoalListView
        goals={state.goals}
        onSelect={handleGoalSelect}
        onCancel={() => setShowGoalList(false)}
      />
    );
  }

  // Main view
  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">PonyBunny Gateway TUI</Text>
        <Text dimColor> - </Text>
        <Text color={statusColor}>{state.connectionStatus}</Text>
        {state.activityStatus !== 'idle' && (
          <>
            <Text dimColor> - </Text>
            <Text color="yellow">{state.activityStatus}</Text>
          </>
        )}
      </Box>

      {/* Message Log */}
      <Box flexDirection="column" flexGrow={1} marginBottom={1} overflow="hidden">
        {messages.length === 0 && (
          <Box paddingX={2}>
            <Text dimColor>Type /help for available commands.</Text>
          </Box>
        )}

        {messages.slice(-20).map((msg, idx) => (
          <Box key={idx} flexDirection="column" paddingX={2}>
            {msg.role === 'user' ? (
              <Text color="green">➤ {msg.content}</Text>
            ) : msg.role === 'event' ? (
              <Text color="magenta">⚡ {msg.content}</Text>
            ) : (
              <Text color="gray">{msg.content}</Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Input */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Box marginRight={1}>
          {state.activityStatus !== 'idle' ? (
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
          ) : (
            <Text color="green">➤</Text>
          )}
        </Box>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type a command (start with /)..."
        />
      </Box>

      {/* Footer */}
      <Box paddingX={2}>
        <Text dimColor>Press ESC or Ctrl+C to exit | Ctrl+L to clear | /help for commands</Text>
      </Box>
    </Box>
  );
};

// ============================================================================
// Entry Point
// ============================================================================

export interface GatewayTuiOptions {
  url?: string;
  token?: string;
}

export async function startGatewayTui(options: GatewayTuiOptions = {}): Promise<void> {
  const { waitUntilExit } = render(
    <GatewayTui url={options.url} token={options.token} />
  );

  await waitUntilExit();
}
