import type { Run, WorkItem } from '../../work-order/types/index.js';

export interface WorkItemRunResultDTO {
  ids: {
    runId: string;
    workItemId: string;
    goalId: string;
  };
  status: Run['status'];
  timing: {
    createdAt: number;
    completedAt?: number;
  };
  usage: {
    tokensUsed: number;
    timeSeconds: number;
    costUsd: number;
  };
  verification: {
    workItemStatus?: WorkItem['status'];
    verificationStatus?: WorkItem['verification_status'];
  };
  output: {
    summary: string;
    executionLog?: string;
    errorMessage?: string;
  };
  artifacts: {
    ids: string[];
    count: number;
  };
}

export interface BuildWorkItemRunResultDTOInput {
  runId: string;
  workItemId: string;
  goalId: string;
  status: Run['status'];
  createdAt: number;
  completedAt?: number;
  tokensUsed?: number;
  timeSeconds?: number;
  costUsd?: number;
  executionLog?: string;
  errorMessage?: string;
  artifactIds?: string[];
  workItemStatus?: WorkItem['status'];
  verificationStatus?: WorkItem['verification_status'];
}

export function firstMeaningfulResultLine(log?: string): string | undefined {
  if (!log) {
    return undefined;
  }

  return log
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('[POLICY_AUDIT]') && !line.startsWith('[ROUTE_CONTEXT]'));
}

export function buildWorkItemRunResultDTO(input: BuildWorkItemRunResultDTOInput): WorkItemRunResultDTO {
  const summary = firstMeaningfulResultLine(input.executionLog)
    || input.errorMessage
    || `Run ${input.status}`;

  const artifactIds = input.artifactIds ?? [];

  return {
    ids: {
      runId: input.runId,
      workItemId: input.workItemId,
      goalId: input.goalId,
    },
    status: input.status,
    timing: {
      createdAt: input.createdAt,
      completedAt: input.completedAt,
    },
    usage: {
      tokensUsed: input.tokensUsed ?? 0,
      timeSeconds: input.timeSeconds ?? 0,
      costUsd: input.costUsd ?? 0,
    },
    verification: {
      workItemStatus: input.workItemStatus,
      verificationStatus: input.verificationStatus,
    },
    output: {
      summary,
      executionLog: input.executionLog,
      errorMessage: input.errorMessage,
    },
    artifacts: {
      ids: artifactIds,
      count: artifactIds.length,
    },
  };
}
