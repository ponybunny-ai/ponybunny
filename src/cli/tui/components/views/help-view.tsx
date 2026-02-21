/**
 * HelpView - Help and documentation view
 */

import * as React from 'react';
import { Box, Text } from 'ink';

const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show this help' },
  { cmd: '/new', desc: 'Create a new goal (interactive)' },
  { cmd: '/goals [status]', desc: 'List goals (optionally filter by status)' },
  { cmd: '/goal <id>', desc: 'Show goal details' },
  { cmd: '/cancel <id> [reason]', desc: 'Cancel a goal' },
  { cmd: '/workitems [goalId]', desc: 'List work items' },
  { cmd: '/dashboard', desc: 'Show the main overview' },
  { cmd: '/events', desc: 'Show recent events' },
  { cmd: '/escalations', desc: 'List pending escalations' },
  { cmd: '/approvals', desc: 'List pending approvals' },
  { cmd: '/approve <id>', desc: 'Approve a request' },
  { cmd: '/reject <id> [reason]', desc: 'Reject a request' },
  { cmd: '/status', desc: 'Show gateway status' },
  { cmd: '/ping', desc: 'Ping the gateway' },
  { cmd: '/clear', desc: 'Clear the event log' },
  { cmd: '/exit', desc: 'Exit the TUI' },
];

const KEYBOARD_SHORTCUTS = [
  { key: 'Tab', desc: 'Switch to next view' },
  { key: 'Ctrl+N', desc: 'Create new goal' },
  { key: 'Ctrl+E', desc: 'Open escalations' },
  { key: '↑ / ↓', desc: 'Navigate command suggestions' },
  { key: 'Enter', desc: 'Select / Confirm' },
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
            You can type a goal description directly in the input bar to create a new goal.
          </Text>
          <Text dimColor>
            For example: "Build a REST API for user management"
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              The system will parse your input and create a goal with appropriate success criteria.
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
