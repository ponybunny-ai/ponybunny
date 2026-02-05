/**
 * GoalCard - Goal summary card
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import type { Goal } from '../../../../work-order/types/index.js';
import { ProgressBar } from './progress-bar.js';
import { StatusBadge } from './status-badge.js';
import { truncate } from '../../utils/formatters.js';

export interface GoalCardProps {
  goal: Goal;
  selected?: boolean;
  compact?: boolean;
  workItemStats?: { completed: number; total: number };
}

export const GoalCard: React.FC<GoalCardProps> = ({
  goal,
  selected = false,
  compact = false,
  workItemStats,
}) => {
  const stats = workItemStats || { completed: 0, total: 0 };
  const titleMaxLength = compact ? 30 : 50;

  if (compact) {
    return (
      <Box>
        <Text color={selected ? 'cyan' : undefined}>
          {selected ? '▶ ' : '  '}
        </Text>
        <StatusBadge status={goal.status} type="goal" />
        <Text> </Text>
        <Text color={selected ? 'white' : undefined}>
          {truncate(goal.title, titleMaxLength)}
        </Text>
        <Text dimColor>  </Text>
        <ProgressBar
          current={stats.completed}
          total={stats.total}
          width={8}
          showPercent={false}
        />
        <Text dimColor> {stats.completed}/{stats.total}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? 'round' : 'single'}
      borderColor={selected ? 'cyan' : 'gray'}
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box>
          <StatusBadge status={goal.status} type="goal" />
          <Text> </Text>
          <Text bold color={selected ? 'cyan' : 'white'}>
            {truncate(goal.title, titleMaxLength)}
          </Text>
        </Box>
        <Text dimColor>P{goal.priority}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{truncate(goal.description, 60)}</Text>
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <ProgressBar
            current={stats.completed}
            total={stats.total}
            width={10}
          />
          <Text dimColor>  {stats.completed}/{stats.total} items</Text>
        </Box>
        <Text dimColor>
          {goal.spent_tokens > 0 && `${Math.round(goal.spent_tokens / 1000)}K tokens`}
        </Text>
      </Box>
    </Box>
  );
};
