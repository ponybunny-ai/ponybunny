/**
 * SimpleView - Main view for simple mode (chat-like interface)
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { SimpleMessageItem } from '../widgets/simple-message-item.js';

export const SimpleView: React.FC = () => {
  const { state } = useAppContext();
  const { simpleMessages, pendingEscalationCount } = state;

  const hasMessages = simpleMessages.length > 0;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Escalation warning banner */}
      {pendingEscalationCount > 0 && (
        <Box
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginBottom={1}
        >
          <Text color="yellow">
            ⚠ {pendingEscalationCount} item(s) need your confirmation (type /escalations to view)
          </Text>
        </Box>
      )}

      {/* Welcome message when no messages */}
      {!hasMessages && (
        <Box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          flexGrow={1}
        >
          <Box marginBottom={1}>
            <Text bold color="cyan">PonyBunny</Text>
          </Box>
          <Text dimColor>Enter your request and I'll help you get it done</Text>
        </Box>
      )}

      {/* Message history */}
      {hasMessages && (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          {simpleMessages.map(message => (
            <SimpleMessageItem key={message.id} message={message} />
          ))}
        </Box>
      )}
    </Box>
  );
};
