/**
 * InputBar - Bottom input bar for commands and natural language input
 */

import * as React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useAppContext } from '../../context/app-context.js';

export interface InputBarProps {
  onSubmit: (input: string) => void;
  placeholder?: string;
  focus?: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSubmit,
  placeholder = 'Describe your goal or type /help for commands',
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
            placeholder={placeholder}
            focus={focus}
          />
        </Box>
      </Box>

      <Box paddingX={2}>
        <Text dimColor>
          {isActive ? (
            <Text color="yellow">{activityStatus}</Text>
          ) : focus ? (
            'ESC unfocus │ Enter submit │ Type command or goal'
          ) : (
            '/ or i to type │ Tab switch view │ 1-4 jump to view │ Ctrl+N new goal'
          )}
        </Text>
      </Box>
    </Box>
  );
};
