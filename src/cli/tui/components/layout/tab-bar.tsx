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
  { id: 'goals', label: 'Goals', shortcut: '2' },
  { id: 'events', label: 'Events', shortcut: '3' },
  { id: 'help', label: 'Help', shortcut: '4' },
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
            >
              [{tab.shortcut}] {tab.label}
            </Text>
          </React.Fragment>
        );
      })}
      <Box flexGrow={1} />
      <Text dimColor>Tab to switch</Text>
    </Box>
  );
};
