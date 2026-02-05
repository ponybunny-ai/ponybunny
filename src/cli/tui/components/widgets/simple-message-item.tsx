/**
 * SimpleMessageItem - Message item for simple mode
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { SimpleMessage } from '../../store/types.js';

export interface SimpleMessageItemProps {
  message: SimpleMessage;
}

export const SimpleMessageItem: React.FC<SimpleMessageItemProps> = ({ message }) => {
  const { input, status, statusText, error } = message;

  const renderStatus = () => {
    switch (status) {
      case 'pending':
        return (
          <Text dimColor>
            <Spinner type="dots" /> Analyzing...
          </Text>
        );
      case 'processing':
        return (
          <Text color="yellow">
            <Spinner type="dots" /> {statusText || 'Processing...'}
          </Text>
        );
      case 'completed':
        return (
          <Text color="green">✓ Completed</Text>
        );
      case 'failed':
        return (
          <Text color="red">✗ Failed: {error || 'Unknown error'}</Text>
        );
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">➤ </Text>
        <Text>{input}</Text>
      </Box>
      <Box marginLeft={2}>
        {renderStatus()}
      </Box>
    </Box>
  );
};
