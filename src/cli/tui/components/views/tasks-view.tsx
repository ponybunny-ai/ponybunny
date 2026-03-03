import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import type { RuntimeSnapshot, SimpleMessage } from '../../store/types.js';
import type { WorkItemRunResultDTO } from '../../../../domain/work-order/result-dto.js';

type RunRecord = WorkItemRunResultDTO;

function fmtTs(ms?: number): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function extractActions(text: string): Array<{ label: string; kind: 'file' | 'url' | 'command'; target: string }> {
  const actions: Array<{ label: string; kind: 'file' | 'url' | 'command'; target: string }> = [];
  const seen = new Set<string>();

  const urlMatches = text.match(/https?:\/\/[^\s)]+/g) || [];
  for (const url of urlMatches.slice(0, 5)) {
    if (seen.has(url)) continue;
    seen.add(url);
    actions.push({ label: `Open URL: ${url}`, kind: 'url', target: url });
  }

  const fileMatches = text.match(/(?:\.|\/|~\/)[\w./-]+\.[\w]+/g) || [];
  for (const path of fileMatches.slice(0, 5)) {
    if (seen.has(path)) continue;
    seen.add(path);
    actions.push({ label: `Open file: ${path}`, kind: 'file', target: path });
  }

  return actions;
}

function latestSummary(message: SimpleMessage, runs: RunRecord[]): string {
  if (message.resultSummary && message.resultSummary.trim().length > 0) {
    return message.resultSummary.trim();
  }

  const latestRun = runs[0];
  if (!latestRun?.output.executionLog) {
    if (message.status === 'completed') return 'Task completed.';
    if (message.status === 'failed') return message.error || 'Task failed.';
    return latestRun?.output.summary || message.statusText || 'Task in progress.';
  }

  const line = latestRun.output.executionLog
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x.length > 0 && !x.startsWith('[POLICY_AUDIT]') && !x.startsWith('[ROUTE_CONTEXT]'));
  return line || latestRun.output.summary || latestRun.output.executionLog.slice(0, 180);
}

function firstMeaningfulLine(log?: string): string | undefined {
  if (!log) return undefined;
  return log
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('[POLICY_AUDIT]') && !line.startsWith('[ROUTE_CONTEXT]'));
}

function findRuntimeSnapshot(
  runtimeSnapshots: RuntimeSnapshot[],
  goalId?: string,
  runId?: string
): RuntimeSnapshot | undefined {
  if (runId) {
    for (let i = runtimeSnapshots.length - 1; i >= 0; i -= 1) {
      if (runtimeSnapshots[i].runId === runId) {
        return runtimeSnapshots[i];
      }
    }
  }

  if (goalId) {
    for (let i = runtimeSnapshots.length - 1; i >= 0; i -= 1) {
      if (runtimeSnapshots[i].goalId === goalId) {
        return runtimeSnapshots[i];
      }
    }
  }
  return runtimeSnapshots[runtimeSnapshots.length - 1];
}

export const WorkstreamView: React.FC = () => {
  const {
    state,
    addSimpleMessage,
    removeSimpleMessage,
    removeGoal,
    setWorkItems,
    setView,
    selectGoal,
    openModal,
  } = useAppContext();
  const gateway = useGatewayContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runsByWorkItem, setRunsByWorkItem] = useState<Record<string, RunRecord[]>>({});
  const [selectedWorkItemIndex, setSelectedWorkItemIndex] = useState(0);
  const [selectedRunIndex, setSelectedRunIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);

  const pageSize = 12;

  const tasks = useMemo(() => {
    const selectedGoalId = state.selectedGoalId;
    const activeSessionId = state.activeSessionId;
    const scopedGoalIds = activeSessionId
      ? new Set(
        state.goals
          .filter((goal) => goal.context?.sessionId === activeSessionId)
          .map((goal) => goal.id)
      )
      : null;
    const scoped = selectedGoalId
      ? state.simpleMessages.filter((message) => message.goalId === selectedGoalId)
      : state.simpleMessages.filter((message) => {
        if (!scopedGoalIds) {
          return true;
        }

        if (!message.goalId) {
          return false;
        }

        return scopedGoalIds.has(message.goalId);
      });
    return [...scoped].sort((a, b) => b.timestamp - a.timestamp);
  }, [state.activeSessionId, state.goals, state.selectedGoalId, state.simpleMessages]);
  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize));
  const pageStart = currentPage * pageSize;
  const pageTasks = tasks.slice(pageStart, pageStart + pageSize);
  const selected = pageTasks[selectedIndex];
  const absoluteSelectedIndex = pageStart + selectedIndex;
  const runtimeSnapshots = state.runtimeSnapshots;

  useEffect(() => {
    if (currentPage >= totalPages) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (selectedIndex >= pageTasks.length) {
      setSelectedIndex(Math.max(0, pageTasks.length - 1));
    }
  }, [pageTasks.length, selectedIndex]);
  const relatedWorkItems = useMemo(() => {
    if (!selected?.goalId) return [];
    return state.workItems
      .filter((wi) => wi.goal_id === selected.goalId)
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [state.workItems, selected?.goalId]);

  useEffect(() => {
    setSelectedWorkItemIndex(0);
    setSelectedRunIndex(0);
  }, [selected?.id]);

  const selectedWorkItemId =
    selected?.workItemId
    || relatedWorkItems[selectedWorkItemIndex]?.id
    || relatedWorkItems[0]?.id;

  useEffect(() => {
    if (!gateway.client || !selectedWorkItemId || runsByWorkItem[selectedWorkItemId]) return;
    let alive = true;
    void gateway.client.getWorkItemRuns(selectedWorkItemId).then((result) => {
      if (!alive) return;
      const runs = (result.runs || []).sort((a, b) => (b.timing.createdAt || 0) - (a.timing.createdAt || 0));
      setRunsByWorkItem((prev) => ({ ...prev, [selectedWorkItemId]: runs }));
    }).catch(() => {
      if (!alive) return;
      setRunsByWorkItem((prev) => ({ ...prev, [selectedWorkItemId]: [] }));
    });
    return () => {
      alive = false;
    };
  }, [gateway.client, selectedWorkItemId, runsByWorkItem]);

  useInput((input, key) => {
    if (state.activeModal) {
      return;
    }

    if (actionBusy) {
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(pageTasks.length - 1, i + 1));
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

    if (input === 'g' && selected?.goalId) {
      selectGoal(selected.goalId);
      setView('goals');
      return;
    }

    if (input === 'w' && relatedWorkItems.length > 0) {
      setSelectedWorkItemIndex((idx) => (idx + 1) % relatedWorkItems.length);
      setSelectedRunIndex(0);
      return;
    }

    if (input === 'n' && runs.length > 0) {
      setSelectedRunIndex((idx) => (idx + 1) % runs.length);
      return;
    }

    if (input === 'p' && runs.length > 0) {
      setSelectedRunIndex((idx) => (idx - 1 + runs.length) % runs.length);
      return;
    }

    if (input === '0' && state.selectedGoalId) {
      selectGoal(null);
      setSelectedIndex(0);
      setCurrentPage(0);
      return;
    }

    if (input === 'r' && selected && selected.status === 'failed') {
      const client = gateway.client;
      if (!client) return;
      setActionBusy(true);
      void (async () => {
        try {
          const prompt = selected.input.trim();
          const goal = await client.submitGoal({
            title: prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt,
            description: prompt,
            success_criteria: [{
              description: 'Task completed as described',
              type: 'heuristic',
              verification_method: 'human review',
              required: true,
            }],
            priority: 50,
          });
          addSimpleMessage({
            id: `msg-retry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            input: prompt,
            status: 'processing',
            statusText: 'Retry queued...',
            goalId: goal.id,
            timeline: [{ timestamp: Date.now(), stage: 'Retry requested', detail: `Retried from task ${selected.id}` }],
            timestamp: Date.now(),
          });
        } catch (error) {
          addSimpleMessage({
            id: `msg-retry-error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            input: `Retry failed: ${selected.input}`,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            timeline: [{ timestamp: Date.now(), stage: 'Retry failed', detail: error instanceof Error ? error.message : String(error) }],
            timestamp: Date.now(),
          });
        } finally {
          setActionBusy(false);
        }
      })();
      return;
    }

    if (input === 'd' && selected?.goalId) {
      const client = gateway.client;
      if (!client) return;

      openModal('confirm', {
        title: 'Delete task?',
        message: `Delete this task and all related goal/work item data?\nGoal: ${selected.goalId}`,
        confirmLabel: 'delete',
        cancelLabel: 'keep',
        onConfirm: () => {
          setActionBusy(true);
          void (async () => {
            try {
              await client.deleteGoal(selected.goalId!);
              removeGoal(selected.goalId!);
              const linked = state.simpleMessages.filter((m) => m.goalId === selected.goalId);
              for (const msg of linked) {
                removeSimpleMessage(msg.id);
              }
              setWorkItems(state.workItems.filter((wi) => wi.goal_id !== selected.goalId));
            } finally {
              setActionBusy(false);
            }
          })();
        },
      });
      return;
    }
  });

  const selectedRuntimeSnapshot = findRuntimeSnapshot(runtimeSnapshots, selected?.goalId, selected?.runId);

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">Workstream</Text>
        <Box marginTop={1}>
          <Text dimColor>
            {state.selectedGoalId
              ? 'No timeline entries for selected goal. Press 0 to clear goal scope.'
              : 'No workstream entries yet. Submit a request in the input bar to create one.'}
          </Text>
        </Box>
        {runtimeSnapshots.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Runtime Diagnostics ({runtimeSnapshots.length})</Text>
            {runtimeSnapshots.slice(-4).reverse().map((snapshot) => (
              <Text key={snapshot.id} dimColor>
                - {fmtTs(snapshot.timestamp)} goal={snapshot.goalId} dryRun={snapshot.dryRun.ok ? 'ok' : 'failed'} status={snapshot.dryRun.status || '-'} events={snapshot.dryRun.totalEvents ?? '-'}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  const runs = selectedWorkItemId ? (runsByWorkItem[selectedWorkItemId] || []) : [];
  const selectedRun = runs[selectedRunIndex] || runs[0];
  const summary = selected ? latestSummary(selected, runs) : '';
  const actionList = selected?.actions && selected.actions.length > 0
    ? selected.actions
    : extractActions(`${summary}\n${runs[0]?.output.executionLog || ''}`);

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" width="42%" borderStyle="round" borderColor="gray" paddingX={1} marginRight={1}>
        <Text bold color="cyan">Workstream Timeline ({tasks.length})</Text>
        <Text dimColor>
          Scope: {state.selectedGoalId
            ? `goal ${state.selectedGoalId.slice(0, 8)} (0 clear)`
            : state.activeSessionId
              ? `session ${state.activeSessionId.slice(0, 8)}`
              : 'all goals'}
        </Text>
        <Text dimColor>j/k or ↑/↓ select · h/l or ←/→ page · g open goal · w next work item · n/p run +/- · r retry failed · d delete</Text>
        <Text dimColor>Page {Math.min(currentPage + 1, totalPages)} / {totalPages}</Text>
        <Box flexDirection="column" marginTop={1}>
          {pageTasks.map((task, idx) => {
            const active = idx === selectedIndex;
            const marker = task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '•';
            return (
              <Box key={task.id}>
                <Text color={active ? 'cyan' : undefined}>{active ? '>' : ' '} {marker} </Text>
                <Text dimColor={!active}>{`${String(pageStart + idx + 1).padStart(3, ' ')}. ${task.input.slice(0, 50)}`}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" width="58%" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">Execution Detail</Text>
        {selected && (
          <>
            <Text>- Status: {selected.status}{selected.statusText ? ` (${selected.statusText})` : ''}</Text>
            <Text>- Index: #{absoluteSelectedIndex + 1}</Text>
            <Text>- Created: {fmtTs(selected.timestamp)}</Text>
            <Text>- Goal: {selected.goalId || '-'}</Text>
            <Text>- Work Item: {selectedWorkItemId || '-'}</Text>
            <Text>- Run: {selectedRun?.ids.runId || '-'}</Text>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Step Timeline</Text>
              {(selected.timeline || []).length === 0 ? (
                <Text dimColor>- No timeline yet.</Text>
              ) : (
                selected.timeline.slice(-8).map((step, idx) => (
                  <Text key={`${step.timestamp}-${idx}`} dimColor>
                    - {fmtTs(step.timestamp)} {step.stage}{step.detail ? `: ${step.detail}` : ''}
                  </Text>
                ))
              )}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Summary</Text>
              <Text>{summary}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Runs</Text>
              {runs.length === 0 ? (
                <Text dimColor>- No run data loaded yet.</Text>
              ) : (
                runs.slice(0, 5).map((run) => (
                  <Text key={run.ids.runId} dimColor>
                    - {run.ids.runId.slice(0, 8)} [{run.status}] completed={fmtTs(run.timing.completedAt)} tokens={run.usage.tokensUsed} cost={typeof run.usage.costUsd === 'number' ? `$${run.usage.costUsd.toFixed(4)}` : '-'}
                  </Text>
                ))
              )}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Selected Run Result</Text>
              {!selectedRun ? (
                <Text dimColor>- Select a run with n/p after run data loads.</Text>
              ) : (
                <>
                  <Text dimColor>- Status: {selectedRun.status}</Text>
                  <Text dimColor>- Completed: {fmtTs(selectedRun.timing.completedAt)}</Text>
                  <Text dimColor>- Tokens: {selectedRun.usage.tokensUsed}</Text>
                  <Text dimColor>
                    - Cost: {typeof selectedRun.usage.costUsd === 'number' ? `$${selectedRun.usage.costUsd.toFixed(4)}` : '-'}
                  </Text>
                  <Text dimColor>- Verification: {selectedRun.verification.verificationStatus || '-'} / {selectedRun.verification.workItemStatus || '-'}</Text>
                  <Text dimColor>- Artifacts: {selectedRun.artifacts.count}</Text>
                  <Text dimColor>
                    - Result: {selectedRun.output.summary || firstMeaningfulLine(selectedRun.output.executionLog) || selectedRun.output.errorMessage || 'No execution summary yet.'}
                  </Text>
                </>
              )}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Suggested Actions</Text>
              {actionList.length === 0 ? (
                <Text dimColor>- No explicit actions detected.</Text>
              ) : (
                actionList.slice(0, 8).map((action, idx) => (
                  <Text key={`${action.kind}-${action.target}-${idx}`} dimColor>
                    - {action.label}
                  </Text>
                ))
              )}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Runtime Diagnostics</Text>
              {!selectedRuntimeSnapshot ? (
                <Text dimColor>- No runtime dry-run snapshot yet. Use /refresh runtime [goalId].</Text>
              ) : (
                <>
                  <Text dimColor>- Snapshot: {fmtTs(selectedRuntimeSnapshot.timestamp)}</Text>
                  <Text dimColor>- Source: {selectedRuntimeSnapshot.source === 'runtime_refresh' ? 'runtime refresh' : 'replay command'}</Text>
                  <Text dimColor>- Goal: {selectedRuntimeSnapshot.goalId}</Text>
                <Text dimColor>- Mode: {selectedRuntimeSnapshot.config.toolRoutingMode}</Text>
                <Text dimColor>- Flags: deterministic={String(selectedRuntimeSnapshot.config.deterministicRuntimeEnabled)} compiler={String(selectedRuntimeSnapshot.config.planCompilerEnabled)}</Text>
                <Text dimColor>- Rollout: shadow={String(selectedRuntimeSnapshot.config.runtimeRollout.shadowModeEnabled)} canary={selectedRuntimeSnapshot.config.runtimeRollout.canaryPercent}% rollback={String(selectedRuntimeSnapshot.config.runtimeRollout.rollbackOnFailure)}</Text>
                <Text dimColor>- LaneCanary: dryRun={selectedRuntimeSnapshot.config.runtimeRollout.lanePercents.dryRun}% compile={selectedRuntimeSnapshot.config.runtimeRollout.lanePercents.compile}% replay={selectedRuntimeSnapshot.config.runtimeRollout.lanePercents.replay}%</Text>
                <Text dimColor>- DryRun: {selectedRuntimeSnapshot.dryRun.ok ? 'ok' : 'failed'} status={selectedRuntimeSnapshot.dryRun.status || '-'}</Text>
                  <Text dimColor>- Runs: compile={selectedRuntimeSnapshot.dryRun.compileRunId || '-'} runtime={selectedRuntimeSnapshot.dryRun.runtimeRunId || '-'}</Text>
                  <Text dimColor>- Replay: events={selectedRuntimeSnapshot.dryRun.totalEvents ?? '-'} facts={selectedRuntimeSnapshot.dryRun.factsCount ?? '-'} artifacts={selectedRuntimeSnapshot.dryRun.artifactsCount ?? '-'}</Text>
                  <Text dimColor>- ReplayPage: returned={selectedRuntimeSnapshot.dryRun.replayPage?.returned ?? '-'} offset={selectedRuntimeSnapshot.dryRun.replayPage?.offset ?? '-'} nextCursor={selectedRuntimeSnapshot.dryRun.replayPage?.nextCursor ?? '-'}</Text>
                  <Text dimColor>- Reexecute: attempted={selectedRuntimeSnapshot.dryRun.reexecution?.attemptedSteps ?? '-'} eligible={selectedRuntimeSnapshot.dryRun.reexecution?.eligibleSteps ?? '-'} executed={selectedRuntimeSnapshot.dryRun.reexecution?.executedSteps ?? '-'} skipped={selectedRuntimeSnapshot.dryRun.reexecution?.skippedSteps ?? '-'}</Text>
                </>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export const TasksView = WorkstreamView;
