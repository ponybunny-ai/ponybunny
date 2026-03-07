/**
 * HelpView - Help and documentation view
 */

import * as React from 'react';
import { Box, Text } from 'ink';

const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show this help' },
  { cmd: '/new', desc: 'Create a new conversation session' },
  { cmd: '/sessions [active|archived|--active-only|--archived-only] [limit] [query]', desc: 'List sessions and open Sessions view (with optional search)' },
  { cmd: '/sessions-reset', desc: 'Reset Sessions view state to defaults' },
  { cmd: '/sessions-export', desc: 'Export current sessions as JSON message' },
  { cmd: '/use <sessionId>', desc: 'Switch active session' },
  { cmd: '/archive-session <sessionId>', desc: 'Archive a session' },
  { cmd: '/resume-session <sessionId>', desc: 'Resume an archived session' },
  { cmd: '/session-history [sessionId] [limit] [role] [offset] [previewLines]', desc: 'Load paged session history (role: all|user|assistant|system)' },
  { cmd: '/session-history-clear', desc: 'Clear all cached history previews' },
  { cmd: '/goals [status]', desc: 'List goals (optionally filter by status)' },
  { cmd: '/goal <id>', desc: 'Show goal details' },
  { cmd: '/workstream', desc: 'Open workstream view (timeline/work items/runs/results)' },
  { cmd: '/cancel <id> [reason]', desc: 'Cancel a goal' },
  { cmd: '/workitems [goalId]', desc: 'List work items and open workstream (goal-scoped when provided)' },
  { cmd: '/retry <workItemId>', desc: 'Retry failed work item' },
  { cmd: '/dashboard', desc: 'Show the main overview' },
  { cmd: '/events', desc: 'Show recent events' },
  { cmd: '/events-export [limit]', desc: 'Export filtered events as JSON message' },
  { cmd: '/events-reset', desc: 'Reset events filter/search state' },
  { cmd: '/escalations', desc: 'List pending escalations' },
  { cmd: '/approvals', desc: 'List pending approvals' },
  { cmd: '/approve <id>', desc: 'Approve a request' },
  { cmd: '/reject <id> [reason]', desc: 'Reject a request' },
  { cmd: '/status', desc: 'Show gateway status' },
  { cmd: '/input-mode [session-first]', desc: 'Show or enforce session-first input routing mode' },
  { cmd: '/refresh [runtime] [goalId]', desc: 'Refresh scheduler or runtime diagnostics' },
  { cmd: '/rollout <status|set|rollback>', desc: 'Inspect or update runtime rollout settings' },
  { cmd: '/replay <runId> [relatedRunId] [key=value...]', desc: 'Run replay diagnostics for runtime events' },
  { cmd: '/pruneevents beforeTsMs=<ms> [key=value...]', desc: 'Prune stored runtime events' },
  { cmd: '/ping', desc: 'Ping the gateway' },
  { cmd: '/clear', desc: 'Clear the event log' },
  { cmd: '/exit', desc: 'Exit the TUI' },
];

const KEYBOARD_SHORTCUTS = [
  { key: 'Tab', desc: 'Switch to next view' },
  { key: 'Ctrl+N', desc: 'Create new session' },
  { key: 'Ctrl+E', desc: 'Open escalations' },
  { key: 'Ctrl+R', desc: 'Refresh scheduler data' },
  { key: '↑ / ↓', desc: 'Navigate command suggestions' },
  { key: 'Enter', desc: 'Select / Confirm (Sessions: activate)' },
  { key: '/ (Sessions)', desc: 'Enter search mode in Sessions view' },
  { key: 'Esc / Enter (search)', desc: 'Exit Sessions search mode' },
  { key: 'q (Sessions)', desc: 'Clear Sessions search query' },
  { key: 'a / h / x / v / y / 1..4 / o / z / m', desc: 'Sessions filters + sort + history fetch/clear/expand preview' },
  { key: 'g / t (Sessions)', desc: 'Drill down to Goals / Workstream' },
  { key: 't (Goals)', desc: 'Drill down to Workstream for selected goal' },
  { key: 'w / n / p / 0 (Workstream)', desc: 'Work item next / run next-prev / clear goal scope' },
  { key: '/ (Events) + q', desc: 'Events search and clear-search' },
  { key: 'ESC', desc: 'Back / Cancel / Exit' },
  { key: 'Ctrl+C', desc: 'Exit' },
];

export const HelpView: React.FC = () => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Slash Commands */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="cyan">Slash Commands</Text>
        <Box marginTop={1} flexDirection="column">
          {SLASH_COMMANDS.map(({ cmd, desc }) => (
            <Box key={cmd}>
              <Text color="yellow">{cmd.padEnd(25)}</Text>
              <Text dimColor>{desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Keyboard Shortcuts */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="cyan">Keyboard Shortcuts</Text>
        <Box marginTop={1} flexDirection="column">
          {KEYBOARD_SHORTCUTS.map(({ key, desc }) => (
            <Box key={key}>
              <Text color="green">{key.padEnd(15)}</Text>
              <Text dimColor>{desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Natural Language Input */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        <Text bold color="cyan">Natural Language Input</Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            You can type naturally in the input bar. The active session analyzes intent and decides whether to create a goal.
          </Text>
          <Text dimColor>
            For example: "Build a REST API for user management"
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
            Drill-down model: session -&gt; goal -&gt; work item -&gt; run -&gt; result.
          </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
