/**
 * InputBar - Bottom input bar for commands and natural language input
 */

import * as React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useAppContext } from '../../context/app-context.js';
import { commands, type CommandDefinition } from '../../commands/registry.js';

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
  const { state, setInputValue } = useAppContext();
  const { activityStatus, inputValue } = state;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastQuery, setLastQuery] = useState('');

  const isActive = activityStatus !== 'idle';

  const getQuery = (value: string) => {
    if (!value.startsWith('/')) {
      return '';
    }
    const match = value.match(/^\/(\S*)/);
    return match?.[1] ?? '';
  };

  const query = getQuery(inputValue);
  const showSuggestions = inputValue.startsWith('/') && !inputValue.slice(1).includes(' ');

  const suggestions = React.useMemo(() => {
    if (!showSuggestions) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const matches = commands.filter(cmd => {
      if (!lowerQuery) {
        return true;
      }
      const nameMatch = cmd.name.includes(lowerQuery);
      const aliasMatch = cmd.aliases?.some(alias => alias.includes(lowerQuery)) ?? false;
      return nameMatch || aliasMatch;
    });

    const scored = matches.sort((a, b) => {
      if (!lowerQuery) return 0;
      const aStarts = a.name.startsWith(lowerQuery);
      const bStarts = b.name.startsWith(lowerQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return 0;
    });

    return scored.slice(0, 8);
  }, [query, showSuggestions]);

  React.useEffect(() => {
    if (query !== lastQuery) {
      setSelectedIndex(0);
      setLastQuery(query);
      return;
    }
    if (selectedIndex >= suggestions.length) {
      setSelectedIndex(0);
    }
  }, [query, lastQuery, selectedIndex, suggestions.length]);

  useInput((_, key) => {
    if (!focus || !showSuggestions || suggestions.length === 0) {
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % suggestions.length);
    }
    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    }
  });

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (showSuggestions && suggestions.length > 0) {
      const selection = suggestions[Math.max(0, Math.min(selectedIndex, suggestions.length - 1))];
      const rest = trimmed.replace(/^\/\S*/, '');
      setInputValue('');
      onSubmit(`/${selection.name}${rest}`);
      return;
    }
    setInputValue('');
    onSubmit(trimmed);
  }, [inputValue, onSubmit, selectedIndex, showSuggestions, suggestions, setInputValue]);

  const renderSuggestion = (cmd: CommandDefinition, index: number) => {
    const isSelected = index === selectedIndex;
    return (
      <Box key={cmd.name}>
        <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
          {isSelected ? '›' : ' '} /{cmd.name}
        </Text>
        <Text dimColor> {cmd.description}</Text>
      </Box>
    );
  };

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
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            placeholder={placeholder}
            focus={focus}
          />
        </Box>
      </Box>

      {showSuggestions && suggestions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {suggestions.map(renderSuggestion)}
        </Box>
      )}

      <Box paddingX={2}>
        <Text dimColor>
          {isActive ? (
            <Text color="yellow">{activityStatus}</Text>
          ) : focus ? (
            'ESC unfocus │ Enter submit │ / for commands'
          ) : (
            '/ or i to type │ Tab switch view │ Ctrl+N new goal │ Ctrl+E escalations'
          )}
        </Text>
      </Box>
    </Box>
  );
};
