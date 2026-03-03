/**
 * TabBar - View switching tabs
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import type { ViewType } from '../../store/types.js';
import { useTerminalSize } from '../../hooks/use-terminal-size.js';

interface Tab {
  id: ViewType;
  label: string;
}

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Workstream' },
  { id: 'goals', label: 'Goals' },
  { id: 'events', label: 'Events' },
];

const TAB_PADDING = 1;
const TAB_GAP = 1;

function renderTabCell(label: string): string {
  return `${' '.repeat(TAB_PADDING)}${label}${' '.repeat(TAB_PADDING)}`;
}

export const TabBar: React.FC = () => {
  const { state, setView, setInputFocused } = useAppContext();
  const { currentView } = state;
  const { columns, rows } = useTerminalSize();

  React.useEffect(() => {
    const stdin = process.stdin;
    if (!stdin?.isTTY) {
      return;
    }

    stdin.write('\u001b[?1000h\u001b[?1006h');

    const tabCells = TABS.map((tab) => ({ id: tab.id, text: renderTabCell(tab.label) }));
    const tabLine = tabCells.map((tab) => tab.text).join(' '.repeat(TAB_GAP));
    const tabStartColumn = Math.max(1, columns - tabLine.length + 1);

    const hitRanges = (() => {
      const ranges: Array<{ id: ViewType; start: number; end: number }> = [];
      let cursor = tabStartColumn;
      for (let i = 0; i < tabCells.length; i += 1) {
        const tab = tabCells[i];
        const start = cursor;
        const end = start + tab.text.length - 1;
        ranges.push({ id: tab.id, start, end });
        cursor = end + 1;
        if (i < tabCells.length - 1) {
          cursor += TAB_GAP;
        }
      }

      for (let i = 0; i < ranges.length; i += 1) {
        if (i > 0) {
          ranges[i].start = Math.max(tabStartColumn, ranges[i].start - 1);
        }
        if (i < ranges.length - 1) {
          ranges[i].end += 1;
        }
      }

      return ranges;
    })();

    const onData = (chunk: Buffer | string) => {
      const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const match = data.match(/\u001b\[<(\d+);(\d+);(\d+)([mM])/);
      if (!match) {
        return;
      }

      const button = Number.parseInt(match[1], 10);
      const x = Number.parseInt(match[2], 10);
      const y = Number.parseInt(match[3], 10);
      const phase = match[4];

      const isLeftButtonPress = button === 0 && phase === 'M';
      const isTabLine = y >= Math.max(1, rows - 2);
      if (!isLeftButtonPress || !isTabLine) {
        return;
      }

      const target = hitRanges.find((range) => x >= range.start && x <= range.end);
      if (target) {
        setInputFocused(false);
        stdin.pause();
        setTimeout(() => {
          try {
            stdin.resume();
          } catch {
            return;
          }
          setInputFocused(true);
        }, 0);
        setView(target.id);
      }
    };

    stdin.on('data', onData);

    return () => {
      stdin.off('data', onData);
      stdin.write('\u001b[?1000l\u001b[?1006l');
    };
  }, [columns, rows, setView]);

  return (
    <Box justifyContent="flex-end">
      {TABS.map((tab, index) => {
        const isActive = currentView === tab.id;
        const cellText = renderTabCell(tab.label);
        return (
          <React.Fragment key={tab.id}>
            {index > 0 && <Text dimColor>{' '.repeat(TAB_GAP)}</Text>}
            <Text
              color={isActive ? 'cyan' : 'gray'}
              bold={isActive}
              wrap="truncate-end"
            >
              {cellText}
            </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
};
