import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import type { SimpleMessage } from '../../store/types.js';

type RunRecord = {
  id: string;
  status: string;
  created_at: number;
  completed_at?: number;
  tokens_used?: number;
  cost_usd?: number;
  execution_log?: string;
  error_message?: string;
};

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
  if (!latestRun?.execution_log) {
    if (message.status === 'completed') return 'Task completed.';
    if (message.status === 'failed') return message.error || 'Task failed.';
    return message.statusText || 'Task in progress.';
  }

  const line = latestRun.execution_log
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x.length > 0 && !x.startsWith('[POLICY_AUDIT]') && !x.startsWith('[ROUTE_CONTEXT]'));
  return line || latestRun.execution_log.slice(0, 180);
}

export const TasksView: React.FC = () => {
  const { state } = useAppContext();
  const gateway = useGatewayContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runsByWorkItem, setRunsByWorkItem] = useState<Record<string, RunRecord[]>>({});

  const tasks = useMemo(() => {
    return [...state.simpleMessages].sort((a, b) => b.timestamp - a.timestamp);
  }, [state.simpleMessages]);

  useEffect(() => {
    if (selectedIndex >= tasks.length) {
      setSelectedIndex(Math.max(0, tasks.length - 1));
    }
  }, [tasks.length, selectedIndex]);

  const selected = tasks[selectedIndex];
  const relatedWorkItems = useMemo(() => {
    if (!selected?.goalId) return [];
    return state.workItems
      .filter((wi) => wi.goal_id === selected.goalId)
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [state.workItems, selected?.goalId]);

  const selectedWorkItemId = selected?.workItemId || relatedWorkItems[0]?.id;

  useEffect(() => {
    if (!gateway.client || !selectedWorkItemId || runsByWorkItem[selectedWorkItemId]) return;
    let alive = true;
    void gateway.client.getWorkItemRuns(selectedWorkItemId).then((result) => {
      if (!alive) return;
      const runs = ((result.runs || []) as RunRecord[]).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
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
    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(tasks.length - 1, i + 1));
    }
  });

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">Tasks</Text>
        <Box marginTop={1}>
          <Text dimColor>No tasks yet. Submit a request in the input bar to create one.</Text>
        </Box>
      </Box>
    );
  }

  const runs = selectedWorkItemId ? (runsByWorkItem[selectedWorkItemId] || []) : [];
  const summary = selected ? latestSummary(selected, runs) : '';
  const actionList = selected?.actions && selected.actions.length > 0
    ? selected.actions
    : extractActions(`${summary}\n${runs[0]?.execution_log || ''}`);

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" width="42%" borderStyle="round" borderColor="gray" paddingX={1} marginRight={1}>
        <Text bold color="cyan">Task List ({tasks.length})</Text>
        <Text dimColor>j/k or ↑/↓ to select</Text>
        <Box flexDirection="column" marginTop={1}>
          {tasks.slice(0, 16).map((task, idx) => {
            const active = idx === selectedIndex;
            const marker = task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '•';
            return (
              <Box key={task.id}>
                <Text color={active ? 'cyan' : undefined}>{active ? '>' : ' '} {marker} </Text>
                <Text dimColor={!active}>{task.input.slice(0, 56)}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" width="58%" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">Task Detail</Text>
        {selected && (
          <>
            <Text>- Status: {selected.status}{selected.statusText ? ` (${selected.statusText})` : ''}</Text>
            <Text>- Created: {fmtTs(selected.timestamp)}</Text>
            <Text>- Goal: {selected.goalId || '-'}</Text>
            <Text>- Work Item: {selectedWorkItemId || '-'}</Text>

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
                  <Text key={run.id} dimColor>
                    - {run.id.slice(0, 8)} [{run.status}] completed={fmtTs(run.completed_at)} tokens={run.tokens_used ?? 0} cost={typeof run.cost_usd === 'number' ? `$${run.cost_usd.toFixed(4)}` : '-'}
                  </Text>
                ))
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
          </>
        )}
      </Box>
    </Box>
  );
};
