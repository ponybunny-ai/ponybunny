/**
 * SimpleInputBar - Simplified input bar for simple mode
 */

import * as React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useAppContext } from '../../context/app-context.js';

export interface SimpleInputBarProps {
  onSubmit: (input: string) => void;
  focus?: boolean;
}

export const SimpleInputBar: React.FC<SimpleInputBarProps> = ({
  onSubmit,
  focus = true,
}) => {
  const { state } = useAppContext();
  const { activityStatus } = state;
  const [input, setInput] = useState('');

  const isActive = activityStatus !== 'idle';

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    onSubmit(trimmed);
  }, [input, onSubmit]);

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor={focus ? 'gray' : 'blackBright'} paddingX={1}>
        <Box marginRight={1}>
          {isActive ? (
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
          ) : (
            <Text color={focus ? 'green' : 'gray'}>➤</Text>
          )}
        </Box>
        <Box flexGrow={1}>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Enter your request..."
            focus={focus}
          />
        </Box>
      </Box>

      <Box paddingX={2} justifyContent="space-between">
        <Text dimColor>
          {isActive ? (
            <Text color="yellow">{activityStatus}</Text>
          ) : (
            '/expert for full UI'
          )}
        </Text>
        <Text dimColor>/help for commands</Text>
      </Box>
    </Box>
  );
};
