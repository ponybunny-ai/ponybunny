/**
 * Tasks View - Goal → WorkItem → Run hierarchy tree
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useDebugContext } from '../context.js';

// ============================================================================
// Status Icons
// ============================================================================

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  // Goal statuses
  pending: { icon: '○', color: 'gray' },
  active: { icon: '●', color: 'yellow' },
  completed: { icon: '✓', color: 'green' },
  failed: { icon: '✗', color: 'red' },
  cancelled: { icon: '⊘', color: 'gray' },

  // WorkItem statuses
  ready: { icon: '○', color: 'cyan' },
  queued: { icon: '◐', color: 'blue' },
  in_progress: { icon: '●', color: 'yellow' },
  verification: { icon: '◉', color: 'magenta' },
  done: { icon: '✓', color: 'green' },
  blocked: { icon: '⊗', color: 'red' },

  // Run statuses
  running: { icon: '▶', color: 'yellow' },
  success: { icon: '✓', color: 'green' },
  error: { icon: '✗', color: 'red' },
};

const getStatusDisplay = (status: string) => {
  return STATUS_ICONS[status] || { icon: '?', color: 'gray' };
};

// ============================================================================
// Run Row Component
// ============================================================================

interface RunRowProps {
  run: {
    id: string;
    status: string;
    startedAt?: number;
    completedAt?: number;
    spentTokens?: number;
    error?: string;
  };
  isLast: boolean;
}

const RunRow: React.FC<RunRowProps> = ({ run, isLast }) => {
  const { icon, color } = getStatusDisplay(run.status);
  const duration = run.startedAt
    ? run.completedAt
      ? `${((run.completedAt - run.startedAt) / 1000).toFixed(1)}s`
      : `${((Date.now() - run.startedAt) / 1000).toFixed(0)}s...`
    : '';

  return (
    <Box paddingLeft={6}>
      <Text dimColor>{isLast ? '└─ ' : '├─ '}</Text>
      <Text color={color as any}>{icon}</Text>
      <Text dimColor> {run.id.slice(0, 8)}</Text>
      <Text dimColor>  </Text>
      <Text color={color as any}>{run.status}</Text>
      {duration && <Text dimColor>  {duration}</Text>}
      {run.spentTokens && <Text dimColor>  {run.spentTokens.toLocaleString()} tokens</Text>}
      {run.error && <Text color="red">  {run.error.slice(0, 30)}</Text>}
    </Box>
  );
};

// ============================================================================
// WorkItem Row Component
// ============================================================================

interface WorkItemRowProps {
  workItem: {
    id: string;
    title: string;
    status: string;
    laneId?: string;
    dependsOn?: string[];
  };
  runs: Array<{
    id: string;
    status: string;
    startedAt?: number;
    completedAt?: number;
    spentTokens?: number;
    error?: string;
  }>;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

const WorkItemRow: React.FC<WorkItemRowProps> = ({ workItem, runs, isLast, isSelected, onSelect }) => {
  const { icon, color } = getStatusDisplay(workItem.status);
  const deps = workItem.dependsOn?.length
    ? ` depends: ${workItem.dependsOn.map(d => d.slice(0, 6)).join(', ')}`
    : '';

  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text dimColor>{isLast ? '└─ ' : '├─ '}</Text>
        <Text color={color as any}>{icon}</Text>
        <Text bold={isSelected} inverse={isSelected}> {workItem.id.slice(0, 8)}</Text>
        <Text dimColor>  </Text>
        <Text>{workItem.title?.slice(0, 40) || 'Untitled'}</Text>
        <Text dimColor>  [{workItem.status}]</Text>
        {workItem.laneId && <Text dimColor>  lane:{workItem.laneId}</Text>}
        {deps && <Text dimColor>{deps}</Text>}
      </Box>
      {runs.map((run, idx) => (
        <RunRow key={run.id} run={run} isLast={idx === runs.length - 1} />
      ))}
    </Box>
  );
};

// ============================================================================
// Goal Tree Component
// ============================================================================

interface GoalTreeProps {
  goal: {
    id: string;
    title: string;
    status: string;
  };
  workItems: Array<{
    workItem: {
      id: string;
      title: string;
      status: string;
      laneId?: string;
      dependsOn?: string[];
    };
    runs: Array<{
      id: string;
      status: string;
      startedAt?: number;
      completedAt?: number;
      spentTokens?: number;
      error?: string;
    }>;
  }>;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onInspect: () => void;
}

const GoalTree: React.FC<GoalTreeProps> = ({
  goal,
  workItems,
  isExpanded,
  isSelected,
  onToggle,
  onInspect,
}) => {
  const { icon, color } = getStatusDisplay(goal.status);
  const expandIcon = isExpanded ? '▼' : '▶';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray">{expandIcon} </Text>
        <Text color={color as any}>{icon}</Text>
        <Text bold={isSelected} inverse={isSelected}> {goal.id.slice(0, 8)}</Text>
        <Text dimColor>  </Text>
        <Text bold>"{goal.title?.slice(0, 40) || 'Untitled'}"</Text>
        <Text dimColor>  [{goal.status}]</Text>
        <Text dimColor>  ({workItems.length} items)</Text>
      </Box>
      {isExpanded && workItems.map((wi, idx) => (
        <WorkItemRow
          key={wi.workItem.id}
          workItem={wi.workItem}
          runs={wi.runs}
          isLast={idx === workItems.length - 1}
          isSelected={false}
          onSelect={() => {}}
        />
      ))}
    </Box>
  );
};

// ============================================================================
// Tasks View
// ============================================================================

export const TasksView: React.FC = () => {
  const { state, toggleGoalExpanded, inspect } = useDebugContext();
  const { goals, schedulerState } = state;
  const [selectedGoalIndex, setSelectedGoalIndex] = React.useState(0);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedGoalIndex(Math.max(0, selectedGoalIndex - 1));
    } else if (key.downArrow) {
      setSelectedGoalIndex(Math.min(goals.length - 1, selectedGoalIndex + 1));
    } else if (key.return) {
      const goal = goals[selectedGoalIndex];
      if (goal) {
        if (state.expandedGoals.has(goal.id)) {
          // Already expanded, inspect it
          inspect({ type: 'goal', id: goal.id });
        } else {
          // Expand it
          toggleGoalExpanded(goal.id);
        }
      }
    } else if (input === ' ') {
      const goal = goals[selectedGoalIndex];
      if (goal) {
        toggleGoalExpanded(goal.id);
      }
    }
  });

  if (goals.length === 0) {
    return (
      <Box padding={2}>
        <Text dimColor>No goals found. Submit a goal to see the task hierarchy.</Text>
      </Box>
    );
  }

  // Get work items for each goal from scheduler state
  const getWorkItemsForGoal = (goalId: string) => {
    const goalState = schedulerState?.goalStates.find(gs => gs.goalId === goalId);
    // For now, return empty array - we'd need to fetch work items separately
    return [];
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">TASK HIERARCHY</Text>
        <Text dimColor>  (↑↓: navigate, Space: expand/collapse, Enter: inspect)</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        {goals.map((goal, idx) => (
          <GoalTree
            key={goal.id}
            goal={goal}
            workItems={getWorkItemsForGoal(goal.id)}
            isExpanded={state.expandedGoals.has(goal.id)}
            isSelected={idx === selectedGoalIndex}
            onToggle={() => toggleGoalExpanded(goal.id)}
            onInspect={() => inspect({ type: 'goal', id: goal.id })}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Showing {goals.length} goals |
          {schedulerState?.activeGoals.length || 0} active
        </Text>
      </Box>
    </Box>
  );
};
