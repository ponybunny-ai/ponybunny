import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { commands } from '../../commands/registry.js';
import { useAppContext } from '../../context/app-context.js';
import { clampSelectedIndex, nextScrollOffset } from './command-palette-state.js';

type CommandPaletteData = {
  onExecute: (command: string) => Promise<void> | void;
};

export const CommandPaletteModal: React.FC = () => {
  const { state, closeModal } = useAppContext();
  const data = state.modalData as CommandPaletteData | undefined;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxVisible = 10;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      if (cmd.name.toLowerCase().includes(q)) return true;
      return (cmd.aliases || []).some((alias) => alias.toLowerCase().includes(q));
    });
  }, [query]);

  React.useEffect(() => {
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [query]);

  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex((current) => clampSelectedIndex(current, filtered.length));
  }, [filtered.length]);

  React.useEffect(() => {
    if (filtered.length === 0) {
      setScrollOffset(0);
      return;
    }

    setScrollOffset((current) => nextScrollOffset({
      selectedIndex,
      currentOffset: current,
      maxVisible,
      total: filtered.length,
    }));
  }, [filtered.length, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      closeModal();
      return;
    }

    if (key.downArrow && filtered.length > 0) {
      setSelectedIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (key.upArrow && filtered.length > 0) {
      setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }

    if (key.return && filtered[selectedIndex] && data) {
      void Promise.resolve(data.onExecute(`/${filtered[selectedIndex].name}`)).finally(() => closeModal());
      return;
    }

    if (input === 'j' && filtered.length > 0) {
      setSelectedIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (input === 'k' && filtered.length > 0) {
      setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
    }
  });

  return (
    <Box flexDirection="column" backgroundColor="gray" padding={1} width={80}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Command Palette</Text>
        <Text bold color="cyan">Esc</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="green">➤ </Text>
        <TextInput value={query} onChange={setQuery} onSubmit={() => {
          if (filtered[selectedIndex] && data) {
            void Promise.resolve(data.onExecute(`/${filtered[selectedIndex].name}`)).finally(() => closeModal());
          }
        }} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        {filtered.slice(scrollOffset, scrollOffset + maxVisible).map((cmd, idx) => {
          const absoluteIndex = scrollOffset + idx;
          const active = absoluteIndex === selectedIndex;
          return (
            <Box key={cmd.name}>
              <Text color={active ? 'cyan' : undefined} bold={active}>{active ? '>' : ' '} /{cmd.name}</Text>
              <Text dimColor> {cmd.description}</Text>
            </Box>
          );
        })}
        {filtered.length > maxVisible && (
          <Text dimColor>
            {scrollOffset + 1}-{Math.min(filtered.length, scrollOffset + maxVisible)} / {filtered.length}
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text bold color="green">↑/↓</Text> select · <Text bold color="green">Enter</Text> execute · <Text bold color="cyan">Esc</Text> close
        </Text>
      </Box>
    </Box>
  );
};
