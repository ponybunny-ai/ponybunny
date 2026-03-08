import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useAppContext } from '../../context/app-context.js';
import { sanitizeModelSelectorQuery } from './model-selector-input-sanitize.js';

type ModelSelectorData = {
  selectedModel: string | null;
  onSelect: (model: string | null) => void;
};

type ModelOption = {
  kind: 'auto' | 'model';
  name: string;
  provider: string;
};

export const ModelSelectorModal: React.FC = () => {
  const { state, closeModal } = useAppContext();
  const data = state.modalData as ModelSelectorData | undefined;
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const models = state.schedulerCapabilities?.capabilities.models ?? [];
  const options = useMemo<ModelOption[]>(() => {
    return [
      {
        kind: 'auto',
        name: 'AUTO',
        provider: 'system',
      },
      ...models.map((model) => ({
        kind: 'model' as const,
      name: model.name,
      provider: model.providers[0] ?? 'unknown',
      })),
    ];
  }, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter((option) => option.name.toLowerCase().includes(q) || option.provider.toLowerCase().includes(q));
  }, [options, query]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length - 1);
    }
  }, [filtered.length, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      closeModal();
      return;
    }

    if (filtered.length === 0) {
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((value) => (value + 1) % filtered.length);
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((value) => (value - 1 + filtered.length) % filtered.length);
      return;
    }

    if (key.return) {
      const target = filtered[selectedIndex];
      if (!target || !data) {
        return;
      }
      data.onSelect(target.kind === 'auto' ? null : target.name);
      closeModal();
    }
  });

  const selected = data?.selectedModel ?? null;

  return (
    <Box flexDirection="column" backgroundColor="gray" padding={1} width={88}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Model Selector</Text>
        <Text bold color="cyan">Esc</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="green">🔎 </Text>
        <TextInput value={query} onChange={(value) => setQuery(sanitizeModelSelectorQuery(value))} placeholder="Search model/provider" />
      </Box>

      <Box marginTop={1} flexDirection="column">
        {filtered.length === 0 ? (
          <Text dimColor>No matching models</Text>
        ) : (
          filtered.slice(0, 14).map((option, index) => {
            const active = index === selectedIndex;
            const isSelected = option.kind === 'auto' ? selected === null : selected === option.name;
            return (
              <Box key={option.name}>
                <Text color={active ? 'cyan' : undefined} bold={active}>
                  {active ? '>' : ' '} {option.provider} / {option.name}{isSelected ? ' (current)' : ''}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text bold color="green">↑/↓</Text> select · <Text bold color="green">Enter</Text> confirm · <Text bold color="cyan">Esc</Text> close
        </Text>
      </Box>
    </Box>
  );
};
