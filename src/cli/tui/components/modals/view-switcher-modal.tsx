import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ViewType } from '../../store/types.js';
import { useAppContext } from '../../context/app-context.js';

type ViewSwitcherData = {
  onSelect: (view: ViewType) => void;
};

const VIEWS: Array<{ id: ViewType; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Workstream' },
  { id: 'goals', label: 'Goals' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'events', label: 'Events' },
];

export const ViewSwitcherModal: React.FC = () => {
  const { state, closeModal } = useAppContext();
  const data = state.modalData as ViewSwitcherData | undefined;
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = VIEWS.findIndex((view) => view.id === state.currentView);
    return idx >= 0 ? idx : 0;
  });

  const selectedView = useMemo(() => VIEWS[selectedIndex] ?? VIEWS[0], [selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      closeModal();
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => (i + 1) % VIEWS.length);
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => (i - 1 + VIEWS.length) % VIEWS.length);
      return;
    }

    if (key.return && selectedView && data) {
      data.onSelect(selectedView.id);
      closeModal();
    }
  });

  return (
    <Box flexDirection="column" backgroundColor="gray" padding={1} width={46}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Switch View</Text>
        <Text bold color="cyan">Esc</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {VIEWS.map((view, idx) => {
          const active = idx === selectedIndex;
          return (
            <Box key={view.id}>
              <Text color={active ? 'cyan' : undefined} bold={active}>{active ? '>' : ' '} {view.label}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text bold color="green">↑/↓</Text> select · <Text bold color="green">Enter</Text> switch · <Text bold color="cyan">Esc</Text> close
        </Text>
      </Box>
    </Box>
  );
};
