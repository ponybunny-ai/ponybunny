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
  { id: 'dashboard', label: 'Dashboard', shortcut: 'Ctrl-V' },
  { id: 'tasks', label: 'Tasks', shortcut: 'Ctrl-V' },
  { id: 'goals', label: 'Goals', shortcut: 'Ctrl-V' },
  { id: 'events', label: 'Events', shortcut: 'Ctrl-V' },
];

export const TabBar: React.FC = () => {
  const { state } = useAppContext();
  const { currentView } = state;

  return (
    <Box>
      {TABS.map((tab, index) => {
        const isActive = currentView === tab.id;
        return (
          <React.Fragment key={tab.id}>
            {index > 0 && <Text dimColor>  </Text>}
            <Text
              color={isActive ? 'black' : 'gray'}
              backgroundColor={isActive ? 'cyan' : undefined}
              bold={isActive}
              wrap="truncate-end"
            >
              {tab.label}
            </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
};
