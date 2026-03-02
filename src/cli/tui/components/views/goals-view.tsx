import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import type { Goal } from '../../../../work-order/types/index.js';

function fmtTs(ms?: number): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function deriveSummary(goal: Goal): string {
  if (goal.status === 'completed') {
    return 'Goal completed.';
  }
  if (goal.status === 'blocked' || goal.status === 'cancelled') {
    return 'Goal failed or blocked.';
  }
  if (goal.status === 'active') {
    return 'Goal is currently running.';
  }
  return 'Goal is queued.';
}

export const GoalsView: React.FC = () => {
  const {
    state,
    setView,
    addSimpleMessage,
    removeSimpleMessage,
    removeGoal,
    setWorkItems,
    selectGoal,
    openModal,
  } = useAppContext();
  const gateway = useGatewayContext();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const pageSize = 12;

  const goals = useMemo(() => {
    return [...state.goals].sort((a, b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at));
  }, [state.goals]);
  const totalPages = Math.max(1, Math.ceil(goals.length / pageSize));
  const pageStart = currentPage * pageSize;
  const pageGoals = goals.slice(pageStart, pageStart + pageSize);
  const selectedGoal = pageGoals[selectedIndex];
  const absoluteSelectedIndex = pageStart + selectedIndex;

  const relatedTasks = useMemo(() => {
    if (!selectedGoal) return [];
    return state.simpleMessages
      .filter((msg) => msg.goalId === selectedGoal.id)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [selectedGoal, state.simpleMessages]);

  const relatedWorkItems = useMemo(() => {
    if (!selectedGoal) return [];
    return state.workItems
      .filter((wi) => wi.goal_id === selectedGoal.id)
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [selectedGoal, state.workItems]);

  useInput((input, key) => {
    if (state.activeModal) {
      return;
    }

    if (actionBusy) return;

    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(pageGoals.length - 1, i + 1));
      return;
    }
    if (key.leftArrow || input === 'h') {
      setCurrentPage((p) => Math.max(0, p - 1));
      setSelectedIndex(0);
      return;
    }
    if (key.rightArrow || input === 'l') {
      setCurrentPage((p) => Math.min(totalPages - 1, p + 1));
      setSelectedIndex(0);
      return;
    }

    if (input === 't' && selectedGoal) {
      selectGoal(selectedGoal.id);
      setView('tasks');
      return;
    }

    if (input === 'r' && selectedGoal && (selectedGoal.status === 'blocked' || selectedGoal.status === 'cancelled')) {
      const client = gateway.client;
      if (!client) return;
      setActionBusy(true);
      void (async () => {
        try {
          const prompt = selectedGoal.description.trim();
          const goal = await client.submitGoal({
            title: selectedGoal.title,
            description: prompt,
            success_criteria: selectedGoal.success_criteria,
            priority: selectedGoal.priority,
            budget_tokens: selectedGoal.budget_tokens,
            budget_time_minutes: selectedGoal.budget_time_minutes,
            budget_cost_usd: selectedGoal.budget_cost_usd,
          });

          addSimpleMessage({
            id: `msg-goal-retry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            input: prompt,
            status: 'processing',
            statusText: 'Goal retry queued...',
            goalId: goal.id,
            timeline: [{ timestamp: Date.now(), stage: 'Goal retry requested', detail: `Retried from goal ${selectedGoal.id}` }],
            timestamp: Date.now(),
          });
        } finally {
          setActionBusy(false);
        }
      })();
      return;
    }

    if (input === 'd' && selectedGoal) {
      const client = gateway.client;
      if (!client) return;
      openModal('confirm', {
        title: 'Delete goal?',
        message: `Delete goal ${selectedGoal.id} and all related tasks/work items?`,
        confirmLabel: 'delete',
        cancelLabel: 'keep',
        onConfirm: () => {
          setActionBusy(true);
          void (async () => {
            try {
              await client.deleteGoal(selectedGoal.id);
              removeGoal(selectedGoal.id);

              const linked = state.simpleMessages.filter((m) => m.goalId === selectedGoal.id);
              for (const msg of linked) {
                removeSimpleMessage(msg.id);
              }

              setWorkItems(state.workItems.filter((wi) => wi.goal_id !== selectedGoal.id));
            } finally {
              setActionBusy(false);
            }
          })();
        },
      });
      return;
    }
  });

  if (goals.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">Goals</Text>
        <Box marginTop={1}>
          <Text dimColor>No goals yet. Submit a request in input bar.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" width="42%" borderStyle="round" borderColor="gray" paddingX={1} marginRight={1}>
        <Text bold color="cyan">Goal List ({goals.length})</Text>
        <Text dimColor>j/k or ↑/↓ select · h/l or ←/→ page · t open tasks · r retry failed · d delete</Text>
        <Text dimColor>Page {Math.min(currentPage + 1, totalPages)} / {totalPages}</Text>
        <Box flexDirection="column" marginTop={1}>
          {pageGoals.map((goal, idx) => {
            const active = idx === selectedIndex;
            const marker = goal.status === 'completed'
              ? '✓'
              : (goal.status === 'blocked' || goal.status === 'cancelled')
                ? '✗'
                : '•';
            const title = goal.title || goal.description;
            return (
              <Box key={goal.id}>
                <Text color={active ? 'cyan' : undefined}>{active ? '>' : ' '} {marker} </Text>
                <Text dimColor={!active}>{`${String(pageStart + idx + 1).padStart(3, ' ')}. ${title.slice(0, 50)}`}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" width="58%" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">Goal Detail</Text>
        {selectedGoal && (
          <>
            <Text>- Status: {selectedGoal.status}</Text>
            <Text>- Index: #{absoluteSelectedIndex + 1}</Text>
            <Text>- Goal ID: {selectedGoal.id}</Text>
            <Text>- Created: {fmtTs(selectedGoal.created_at)}</Text>
            <Text>- Updated: {fmtTs(selectedGoal.updated_at)}</Text>
            <Text>- Priority: {selectedGoal.priority}</Text>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Description</Text>
              <Text>{selectedGoal.description}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Summary</Text>
              <Text>{deriveSummary(selectedGoal)}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Related Tasks ({relatedTasks.length})</Text>
              {relatedTasks.length === 0 ? (
                <Text dimColor>- No linked tasks.</Text>
              ) : (
                relatedTasks.slice(0, 6).map((task) => (
                  <Text key={task.id} dimColor>
                    - [{task.status}] {task.input.slice(0, 72)}
                  </Text>
                ))
              )}
              <Text dimColor>- Press t to jump to Tasks view for this goal.</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Related Work Items ({relatedWorkItems.length})</Text>
              {relatedWorkItems.length === 0 ? (
                <Text dimColor>- No work items.</Text>
              ) : (
                relatedWorkItems.slice(0, 6).map((wi) => (
                  <Text key={wi.id} dimColor>
                    - {wi.id.slice(0, 8)} [{wi.status}] {wi.title.slice(0, 64)}
                  </Text>
                ))
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};
