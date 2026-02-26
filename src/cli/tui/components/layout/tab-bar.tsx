/**
 * TabBar - View switching tabs
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import type { ViewType } from '../../store/types.js';

interface Tab {
  id: ViewType;
  label: string;
  shortcut: string;
}

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', shortcut: '1' },
  { id: 'tasks', label: 'Tasks', shortcut: '2' },
  { id: 'goals', label: 'Goals', shortcut: '3' },
  { id: 'events', label: 'Events', shortcut: '4' },
  { id: 'help', label: 'Help', shortcut: '5' },
];

export const TabBar: React.FC = () => {
  const { state } = useAppContext();
  const { currentView } = state;

  return (
    <Box paddingX={1} marginBottom={1}>
      {TABS.map((tab, index) => {
        const isActive = currentView === tab.id;
        return (
          <React.Fragment key={tab.id}>
            {index > 0 && <Text dimColor>  </Text>}
            <Text
              color={isActive ? 'cyan' : undefined}
              bold={isActive}
              dimColor={!isActive}
              wrap="truncate-end"
            >
              [{tab.shortcut}] {tab.label}
            </Text>
          </React.Fragment>
        );
      })}
      <Box flexGrow={1} />
      <Text dimColor wrap="truncate-end">Tab to switch</Text>
    </Box>
  );
};
