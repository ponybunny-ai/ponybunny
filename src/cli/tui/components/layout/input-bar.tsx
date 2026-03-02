/**
 * InputBar - Bottom input bar for commands and natural language input
 */

import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useAppContext } from '../../context/app-context.js';
import { commands } from '../../commands/registry.js';
import { normalizeSlashCommandInput } from './input-normalize.js';
import { TabBar } from './tab-bar.js';
import { loadRuntimeConfig } from '../../../../infra/config/runtime-config.js';
import { shouldHandleSuggestionNavigation } from './input-focus-guard.js';
import { stripMouseEscapeSequences } from './input-mouse-sanitize.js';
import {
  buildSuggestionRows,
  getCommandRows,
  type SuggestionRow,
} from './input-suggestion-state.js';

export interface InputBarProps {
  onSubmit: (input: string) => void;
  placeholder?: string;
  focus?: boolean;
  footerStatus: string;
  showTabBar?: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSubmit,
  placeholder = 'Describe your goal or type /help for commands',
  focus = true,
  footerStatus,
  showTabBar = true,
}) => {
  const { state, setInputValue } = useAppContext();
  const { activityStatus, inputValue: externalInputValue } = state;
  const isDashboardView = state.currentView === 'dashboard';
  const runtimeConfig = loadRuntimeConfig();
  const [draftValue, setDraftValue] = useState(externalInputValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastQuery, setLastQuery] = useState('');
  const [paletteScrollOffset, setPaletteScrollOffset] = useState(0);
  const maxVisibleSuggestions = 12;

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
    const sanitized = stripMouseEscapeSequences(value);
    setDraftValue((current) => normalizeSlashCommandInput(current, sanitized));
  }, []);

  const suggestionRows = React.useMemo<SuggestionRow[]>(() => {
    if (!showSuggestions) {
      return [];
    }

    return buildSuggestionRows(commands, query, 'alpha');
  }, [query, showSuggestions]);

  const commandRows = React.useMemo(() => getCommandRows(suggestionRows), [suggestionRows]);

  React.useEffect(() => {
    if (query !== lastQuery) {
      setSelectedIndex(0);
      setLastQuery(query);
      return;
    }
    if (selectedIndex >= commandRows.length) {
      setSelectedIndex(0);
    }
  }, [query, lastQuery, selectedIndex, commandRows.length]);

  React.useEffect(() => {
    if (!showSuggestions || commandRows.length === 0) {
      setPaletteScrollOffset(0);
      return;
    }

    setPaletteScrollOffset((current) => {
      let next = current;
      if (selectedIndex < current) {
        next = selectedIndex;
      } else if (selectedIndex >= current + maxVisibleSuggestions) {
        next = selectedIndex - maxVisibleSuggestions + 1;
      }

      const maxOffset = Math.max(0, commandRows.length - maxVisibleSuggestions);
      return Math.max(0, Math.min(next, maxOffset));
    });
  }, [showSuggestions, commandRows.length, selectedIndex]);

  useInput((_, key) => {
    if (!shouldHandleSuggestionNavigation({
      focus,
      hasActiveModal: Boolean(state.activeModal),
      showSuggestions,
      suggestionCount: commandRows.length,
    })) {
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % commandRows.length);
    }
    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + commandRows.length) % commandRows.length);
    }
  });

  const handleSubmit = useCallback(() => {
    const trimmed = draftValue.trim();
    if (!trimmed) return;
    if (showSuggestions && commandRows.length > 0) {
      const selection = commandRows[Math.max(0, Math.min(selectedIndex, commandRows.length - 1))].command;
      const rest = trimmed.replace(/^\/\S*/, '');
      setDraftValue('');
      setInputValue('');
      onSubmit(`/${selection.name}${rest}`);
      return;
    }
    setDraftValue('');
    setInputValue('');
    onSubmit(trimmed);
  }, [draftValue, onSubmit, selectedIndex, showSuggestions, commandRows, setInputValue]);

  return (
    <Box flexDirection="column">
      {!isDashboardView ? (
        <Box flexDirection="column" paddingX={2}>
          <TabBar />
        </Box>
      ) : (
        <>
      <Box
        flexDirection="column"

        paddingX={1}
        paddingTop={1}
        backgroundColor="#2a2a2a"
        width="100%"
      >
        <Box paddingBottom={1}>
          <Box width={2}>
            {isActive ? (
              <Text color="yellow">
                <Spinner type="dots" />
              </Text>
            ) : (
              <Text color={focus ? 'green' : 'gray'}>{'> '}</Text>
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
        <Box>
          <Text color={runtimeConfig.tui.inputBackgroundColor === 'gray' ? 'white' : undefined}>
            {isActive ? <Text color="yellow">{activityStatus}</Text> : footerStatus}
          </Text>
        </Box>
      </Box>

      {showSuggestions && commandRows.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {(() => {
            const visible = commandRows.slice(paletteScrollOffset, paletteScrollOffset + maxVisibleSuggestions);

            return visible.map((row, idx) => {
              const absoluteIndex = paletteScrollOffset + idx;
              const isSelected = absoluteIndex === selectedIndex;

              return (
                <React.Fragment key={row.command.name}>
                  <Box>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '>' : ' '} /{row.command.name}
                    </Text>
                    <Text dimColor wrap="truncate-end"> {row.command.description}</Text>
                  </Box>
                </React.Fragment>
              );
            });
          })()}
          {commandRows.length > maxVisibleSuggestions && (
            <Text dimColor>
              {paletteScrollOffset + 1}-{Math.min(commandRows.length, paletteScrollOffset + maxVisibleSuggestions)} / {commandRows.length}
            </Text>
          )}
        </Box>
      )}

      {showTabBar && (
        <Box flexDirection="column" paddingX={2}>
          <TabBar />
        </Box>
      )}
        </>
      )}
    </Box>
  );
};
