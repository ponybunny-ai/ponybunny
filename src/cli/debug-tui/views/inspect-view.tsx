/**
 * Inspect View - Detailed entity inspection
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useDebugContext } from '../context.js';
import type { DebugGoalTree } from '../types.js';
import type { WorkItem, Run } from '../../../work-order/types/index.js';

// ============================================================================
// Detail Row Component
// ============================================================================

interface DetailRowProps {
  label: string;
  value: string | number | undefined | null;
  color?: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value, color }) => {
  if (value === undefined || value === null) return null;

  return (
    <Box>
      <Text dimColor>{label}: </Text>
      <Text color={color as any}>{String(value)}</Text>
    </Box>
  );
};

// ============================================================================
// Goal Details Component
// ============================================================================

interface GoalDetailsProps {
  data: DebugGoalTree;
}

const GoalDetails: React.FC<GoalDetailsProps> = ({ data }) => {
  const { goal, executionState, workItems, escalations } = data;

  const statusColor: Record<string, string> = {
    queued: 'gray',
    active: 'yellow',
    blocked: 'red',
    completed: 'green',
    cancelled: 'gray',
  };
  const goalStatusColor = statusColor[goal.status] || 'white';

  const completedItems = workItems.filter(wi => wi.workItem.status === 'done').length;
  const progress = workItems.length > 0
    ? Math.round((completedItems / workItems.length) * 100)
    : 0;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">GOAL DETAILS</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        <DetailRow label="ID" value={goal.id} />
        <DetailRow label="Title" value={goal.title} />
        <DetailRow label="Status" value={goal.status} color={goalStatusColor} />
        <DetailRow label="Priority" value={goal.priority} />
        <DetailRow label="Created" value={goal.created_at ? new Date(goal.created_at).toLocaleString() : undefined} />
        <DetailRow label="Started" value={executionState?.startedAt ? new Date(executionState.startedAt).toLocaleString() : undefined} />

        <Box marginTop={1}>
          <Text dimColor>Progress: </Text>
          <Text color={progress === 100 ? 'green' : 'yellow'}>
            {'█'.repeat(Math.floor(progress / 10))}{'░'.repeat(10 - Math.floor(progress / 10))}
          </Text>
          <Text dimColor> {progress}% ({completedItems}/{workItems.length})</Text>
        </Box>

        {executionState?.error && (
          <Box marginTop={1}>
            <Text color="red">Error: {executionState.error}</Text>
          </Box>
        )}
      </Box>

      {/* Work Items */}
      <Box marginTop={1} marginBottom={1}>
        <Text bold color="cyan">WORK ITEMS ({workItems.length})</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        {workItems.length === 0 ? (
          <Text dimColor>No work items</Text>
        ) : (
          workItems.slice(0, 10).map(({ workItem, runs }) => {
            const wiStatusColors: Record<string, string> = {
              ready: 'cyan',
              queued: 'blue',
              in_progress: 'yellow',
              verify: 'magenta',
              done: 'green',
              failed: 'red',
              blocked: 'red',
            };
            const wiStatusColor = wiStatusColors[workItem.status] || 'gray';

            return (
              <Box key={workItem.id} marginBottom={1} flexDirection="column">
                <Box>
                  <Text color={wiStatusColor as any}>● </Text>
                  <Text>{workItem.id.slice(0, 8)}</Text>
                  <Text dimColor>  </Text>
                  <Text>{workItem.title?.slice(0, 40)}</Text>
                  <Text dimColor>  [{workItem.status}]</Text>
                </Box>
                {runs.length > 0 && (
                  <Box paddingLeft={2}>
                    <Text dimColor>
                      {runs.length} run(s), latest: {runs[0]?.status}
                      {runs[0]?.tokens_used ? `, ${runs[0].tokens_used} tokens` : ''}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })
        )}
        {workItems.length > 10 && (
          <Text dimColor>... and {workItems.length - 10} more</Text>
        )}
      </Box>

      {/* Escalations */}
      {escalations.length > 0 && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text bold color="yellow">ESCALATIONS ({escalations.length})</Text>
          </Box>
          <Box flexDirection="column" borderStyle="single" borderColor="yellow" padding={1}>
            {escalations.map((esc: any, idx) => (
              <Box key={idx}>
                <Text color="yellow">● </Text>
                <Text>{esc.type || 'Unknown'}</Text>
                <Text dimColor>  {esc.reason || ''}</Text>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

// ============================================================================
// WorkItem Details Component
// ============================================================================

interface WorkItemDetailsProps {
  data: WorkItem;
}

const WorkItemDetails: React.FC<WorkItemDetailsProps> = ({ data }) => {
  const statusColors: Record<string, string> = {
    ready: 'cyan',
    queued: 'blue',
    in_progress: 'yellow',
    verify: 'magenta',
    done: 'green',
    failed: 'red',
    blocked: 'red',
  };
  const statusColor = statusColors[data.status] || 'gray';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">WORK ITEM DETAILS</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        <DetailRow label="ID" value={data.id} />
        <DetailRow label="Title" value={data.title} />
        <DetailRow label="Status" value={data.status} color={statusColor} />
        <DetailRow label="Goal ID" value={data.goal_id} />
        <DetailRow label="Assigned Agent" value={data.assigned_agent} />
        <DetailRow label="Retry Count" value={`${data.retry_count || 0}/${data.max_retries || 3}`} />
        <DetailRow label="Created" value={data.created_at ? new Date(data.created_at).toLocaleString() : undefined} />

        {data.dependencies && data.dependencies.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>Dependencies: </Text>
            <Text>{data.dependencies.join(', ')}</Text>
          </Box>
        )}

        {data.blocks && data.blocks.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>Blocks: </Text>
            <Text color="yellow">{data.blocks.join(', ')}</Text>
          </Box>
        )}
      </Box>

      {/* Description */}
      {data.description && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text bold color="cyan">DESCRIPTION</Text>
          </Box>
          <Box borderStyle="single" borderColor="gray" padding={1}>
            <Text>{data.description.slice(0, 500)}</Text>
            {data.description.length > 500 && <Text dimColor>...</Text>}
          </Box>
        </>
      )}
    </Box>
  );
};

// ============================================================================
// Run Details Component
// ============================================================================

interface RunDetailsProps {
  data: Run;
}

const RunDetails: React.FC<RunDetailsProps> = ({ data }) => {
  const statusColors: Record<string, string> = {
    running: 'yellow',
    success: 'green',
    failure: 'red',
    timeout: 'magenta',
    aborted: 'gray',
  };
  const statusColor = statusColors[data.status] || 'gray';

  const duration = data.created_at
    ? data.completed_at
      ? `${((data.completed_at - data.created_at) / 1000).toFixed(2)}s`
      : `${((Date.now() - data.created_at) / 1000).toFixed(0)}s (running)`
    : undefined;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">RUN DETAILS</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        <DetailRow label="ID" value={data.id} />
        <DetailRow label="Status" value={data.status} color={statusColor} />
        <DetailRow label="Work Item ID" value={data.work_item_id} />
        <DetailRow label="Goal ID" value={data.goal_id} />
        <DetailRow label="Agent Type" value={data.agent_type} />
        <DetailRow label="Run Sequence" value={data.run_sequence} />
        <DetailRow label="Duration" value={duration} />
        <DetailRow label="Tokens Used" value={data.tokens_used?.toLocaleString()} />
        <DetailRow label="Cost" value={data.cost_usd ? `$${data.cost_usd.toFixed(4)}` : undefined} />
        <DetailRow label="Started" value={data.created_at ? new Date(data.created_at).toLocaleString() : undefined} />
        <DetailRow label="Completed" value={data.completed_at ? new Date(data.completed_at).toLocaleString() : undefined} />

        {data.error_message && (
          <Box marginTop={1}>
            <Text color="red">Error: {data.error_message}</Text>
          </Box>
        )}
      </Box>

      {/* Execution Log */}
      {data.execution_log && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text bold color="cyan">EXECUTION LOG</Text>
          </Box>
          <Box borderStyle="single" borderColor="gray" padding={1}>
            <Text>{String(data.execution_log).slice(0, 500)}</Text>
            {String(data.execution_log).length > 500 && <Text dimColor>...</Text>}
          </Box>
        </>
      )}
    </Box>
  );
};

// ============================================================================
// Inspect View
// ============================================================================

export const InspectView: React.FC = () => {
  const { state, inspect, setView } = useDebugContext();
  const { inspectTarget, inspectData } = state;

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || input === 'b') {
      // Go back to previous view
      inspect(null);
      setView('overview');
    }
  });

  if (!inspectTarget) {
    return (
      <Box padding={2} flexDirection="column">
        <Text bold color="cyan">INSPECT</Text>
        <Box marginTop={1}>
          <Text dimColor>
            No entity selected. Select an item from Tasks, Lanes, or Events view and press Enter to inspect.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press 'b' or Esc to go back.</Text>
        </Box>
      </Box>
    );
  }

  if (!inspectData) {
    return (
      <Box padding={2} flexDirection="column">
        <Text bold color="cyan">INSPECT: {inspectTarget.type} {inspectTarget.id.slice(0, 8)}</Text>
        <Box marginTop={1}>
          <Text dimColor>Loading...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text dimColor>Inspecting {inspectTarget.type}: {inspectTarget.id}</Text>
        <Text dimColor>  (b/Esc: back)</Text>
      </Box>

      {inspectTarget.type === 'goal' && (
        <GoalDetails data={inspectData as DebugGoalTree} />
      )}
      {inspectTarget.type === 'workitem' && (
        <WorkItemDetails data={inspectData as WorkItem} />
      )}
      {inspectTarget.type === 'run' && (
        <RunDetails data={inspectData as Run} />
      )}
    </Box>
  );
};
