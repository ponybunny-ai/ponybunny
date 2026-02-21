/**
 * GoalsView - Goals list and management view
 */

import * as React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGateway } from '../../hooks/use-gateway.js';
import { useGoals } from '../../hooks/use-goals.js';
import { GoalCard } from '../widgets/goal-card.js';
import { StatusBadge } from '../widgets/status-badge.js';
import { formatDateTime, truncate } from '../../utils/formatters.js';
import type { Goal, GoalStatus } from '../../../../work-order/types/index.js';

type FilterStatus = GoalStatus | 'all';
const FILTER_OPTIONS: FilterStatus[] = ['all', 'active', 'queued', 'blocked', 'completed'];

export const GoalsView: React.FC = () => {
  const { openModal } = useAppContext();
  const { refreshGoals, isConnected } = useGateway();
  const { goals, selectGoal } = useGoals();

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);

  // Load goals on mount
  useEffect(() => {
    if (isConnected) {
      refreshGoals();
    }
  }, [isConnected, refreshGoals]);

  // Filter goals
  const filteredGoals = filter === 'all'
    ? goals
    : goals.filter(g => g.status === filter);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= filteredGoals.length) {
      setSelectedIndex(Math.max(0, filteredGoals.length - 1));
    }
  }, [filteredGoals.length, selectedIndex]);

  // Update selected goal
  const selectedGoal = filteredGoals[selectedIndex];

  useEffect(() => {
    if (selectedGoal?.id) {
      selectGoal(selectedGoal.id);
    }
  }, [selectedGoal?.id, selectGoal]);

  // Handle keyboard input
  useInput((input, key) => {
    if (showDetail) {
      if (key.escape || input === 'q') {
        setShowDetail(false);
      }
      return;
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(i => Math.min(filteredGoals.length - 1, i + 1));
    } else if (key.leftArrow || key.rightArrow) {
      const direction = key.rightArrow ? 1 : -1;
      setFilter(current => {
        const currentIndex = FILTER_OPTIONS.indexOf(current);
        const nextIndex = (currentIndex + direction + FILTER_OPTIONS.length) % FILTER_OPTIONS.length;
        return FILTER_OPTIONS[nextIndex];
      });
    }

    // Actions
    if (key.return && selectedGoal) {
      setShowDetail(true);
    }

    // Filter shortcuts
    if (input === 'a') setFilter('all');
    if (input === 'q') setFilter('queued');
    if (input === 'r') setFilter('active'); // r for running
    if (input === 'c') setFilter('completed');
    if (input === 'b') setFilter('blocked');

    // New goal
    if (input === 'n') {
      openModal('goal-create');
    }
  });

  // Detail view
  if (showDetail && selectedGoal) {
    return <GoalDetailView goal={selectedGoal} onBack={() => setShowDetail(false)} />;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Filter bar */}
      <Box marginBottom={1}>
        <Text dimColor>Filter: </Text>
        {FILTER_OPTIONS.map((f, i) => (
          <React.Fragment key={f}>
            {i > 0 && <Text dimColor> │ </Text>}
            <Text
              color={filter === f ? 'cyan' : undefined}
              bold={filter === f}
              dimColor={filter !== f}
            >
              {f}
            </Text>
          </React.Fragment>
        ))}
        <Box flexGrow={1} />
        <Text dimColor>←/→: filter │ n: new │ Enter: detail │ j/k: navigate</Text>
      </Box>

      {/* Goals list */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexGrow={1}
      >
        <Text bold color="cyan">Goals ({filteredGoals.length})</Text>
        <Box marginTop={1} flexDirection="column">
          {filteredGoals.length === 0 ? (
            <Text dimColor>
              {filter === 'all'
                ? 'No goals yet. Press n to create one.'
                : `No ${filter} goals.`}
            </Text>
          ) : (
            filteredGoals.slice(0, 10).map((goal, index) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                selected={index === selectedIndex}
                compact
                workItemStats={{ completed: 0, total: 0 }}
              />
            ))
          )}
          {filteredGoals.length > 10 && (
            <Text dimColor>  ... and {filteredGoals.length - 10} more</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

// Goal Detail View
interface GoalDetailViewProps {
  goal: Goal;
  onBack: () => void;
}

const GoalDetailView: React.FC<GoalDetailViewProps> = ({ goal, onBack }) => {
  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text dimColor>← Press ESC or q to go back</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">{goal.title}</Text>
          <StatusBadge status={goal.status} type="goal" />
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>ID: {goal.id}</Text>
          <Text dimColor>Priority: {goal.priority}</Text>
          <Text dimColor>Created: {formatDateTime(goal.created_at)}</Text>
          <Text dimColor>Updated: {formatDateTime(goal.updated_at)}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Description:</Text>
          <Text>{goal.description}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Success Criteria:</Text>
          {goal.success_criteria.map((c, i) => (
            <Text key={i} dimColor>  {i + 1}. {truncate(c.description, 60)}</Text>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Budget & Spend:</Text>
          <Text dimColor>  Tokens: {goal.spent_tokens} / {goal.budget_tokens || '∞'}</Text>
          <Text dimColor>  Time: {goal.spent_time_minutes}m / {goal.budget_time_minutes || '∞'}m</Text>
          <Text dimColor>  Cost: ${goal.spent_cost_usd.toFixed(2)} / ${goal.budget_cost_usd?.toFixed(2) || '∞'}</Text>
        </Box>
      </Box>
    </Box>
  );
};
