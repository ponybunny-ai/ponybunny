/**
 * InputBar - Bottom input bar for commands and natural language input
 */

import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useAppContext } from '../../context/app-context.js';
import { commands, type CommandDefinition } from '../../commands/registry.js';
import { normalizeSlashCommandInput } from './input-normalize.js';
import { TabBar } from './tab-bar.js';
import { loadRuntimeConfig } from '../../../../infra/config/runtime-config.js';
import { shouldHandleSuggestionNavigation } from './input-focus-guard.js';

export interface InputBarProps {
  onSubmit: (input: string) => void;
  placeholder?: string;
  focus?: boolean;
  footerStatus: string;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSubmit,
  placeholder = 'Describe your goal or type /help for commands',
  focus = true,
  footerStatus,
}) => {
  const { state, setInputValue } = useAppContext();
  const { activityStatus, inputValue: externalInputValue } = state;
  const runtimeConfig = loadRuntimeConfig();
  const [draftValue, setDraftValue] = useState(externalInputValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastQuery, setLastQuery] = useState('');

  useEffect(() => {
    setDraftValue(externalInputValue);
  }, [externalInputValue]);

  const isActive = activityStatus !== 'idle';

  const getQuery = (value: string) => {
    if (!value.startsWith('/')) {
      return '';
    }
    const match = value.match(/^\/(\S*)/);
    return match?.[1] ?? '';
  };

  const query = getQuery(draftValue);
  const showSuggestions = draftValue.startsWith('/') && !draftValue.slice(1).includes(' ');

  const handleInputChange = useCallback((value: string) => {
    setDraftValue((current) => normalizeSlashCommandInput(current, value));
  }, []);

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

    return scored.slice(0, 5);
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
    if (!shouldHandleSuggestionNavigation({
      focus,
      hasActiveModal: Boolean(state.activeModal),
      showSuggestions,
      suggestionCount: suggestions.length,
    })) {
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
    const trimmed = draftValue.trim();
    if (!trimmed) return;
    if (showSuggestions && suggestions.length > 0) {
      const selection = suggestions[Math.max(0, Math.min(selectedIndex, suggestions.length - 1))];
      const rest = trimmed.replace(/^\/\S*/, '');
      setDraftValue('');
      setInputValue('');
      onSubmit(`/${selection.name}${rest}`);
      return;
    }
    setDraftValue('');
    setInputValue('');
    onSubmit(trimmed);
  }, [draftValue, onSubmit, selectedIndex, showSuggestions, suggestions, setInputValue]);

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
      <Box borderStyle="single" borderColor={focus ? 'gray' : 'blackBright'} paddingX={1} backgroundColor={runtimeConfig.tui.inputBackgroundColor}>
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
            value={draftValue}
            onChange={handleInputChange}
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

      <Box paddingX={2} backgroundColor={runtimeConfig.tui.inputBackgroundColor}>
        <Box flexGrow={1}>
          <Text dimColor>
            {isActive ? (
              <Text color="yellow">{activityStatus}</Text>
            ) : (
              footerStatus
            )}
          </Text>
        </Box>
        <TabBar />
      </Box>
    </Box>
  );
};
