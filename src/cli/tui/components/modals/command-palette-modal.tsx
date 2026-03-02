import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { commands } from '../../commands/registry.js';
import { useAppContext } from '../../context/app-context.js';

type CommandPaletteData = {
  onExecute: (command: string) => Promise<void> | void;
};

export const CommandPaletteModal: React.FC = () => {
  const { state, closeModal } = useAppContext();
  const data = state.modalData as CommandPaletteData | undefined;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      if (cmd.name.toLowerCase().includes(q)) return true;
      return (cmd.aliases || []).some((alias) => alias.toLowerCase().includes(q));
    });
  }, [query]);

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
        {filtered.slice(0, 10).map((cmd, idx) => {
          const active = idx === selectedIndex;
          return (
            <Box key={cmd.name}>
              <Text color={active ? 'cyan' : undefined} bold={active}>{active ? '>' : ' '} /{cmd.name}</Text>
              <Text dimColor> {cmd.description}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text bold color="green">↑/↓</Text> select · <Text bold color="green">Enter</Text> execute · <Text bold color="cyan">Esc</Text> close
        </Text>
      </Box>
    </Box>
  );
};
