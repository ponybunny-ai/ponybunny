import type { ToolFailure, ToolRequest, ToolResult } from './types.js';

export type ToolRequestRegistryState = 'pending' | 'resolved';
export type ToolRequestTerminalOutcome = 'success' | 'failure' | 'invalid';

export interface ToolRequestIdentitySnapshot {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId?: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolRequestTerminalMetadata {
  outcome: ToolRequestTerminalOutcome;
  resolvedAt: number;
  success: boolean;
  failureCode?: string;
  failureMessage?: string;
  ignoredCompletionCount: number;
}

export interface ToolRequestRegistryEntrySnapshot extends ToolRequestIdentitySnapshot {
  state: ToolRequestRegistryState;
  registeredAt: number;
  terminal?: ToolRequestTerminalMetadata;
}

export interface ToolRequestRegistrySnapshot {
  pending: ToolRequestRegistryEntrySnapshot[];
  recent: ToolRequestRegistryEntrySnapshot[];
}

export type ToolRequestRegistration =
  | {
      kind: 'registered';
      promise: Promise<ToolResult>;
      owner: ToolRequestResolutionOwner;
      entry: ToolRequestRegistryEntrySnapshot;
    }
  | {
      kind: 'duplicate';
      promise: Promise<ToolResult>;
      entry: ToolRequestRegistryEntrySnapshot;
    }
  | {
      kind: 'conflict';
      entry: ToolRequestRegistryEntrySnapshot;
    };

interface ToolRequestRegistryEntry extends ToolRequestIdentitySnapshot {
  state: ToolRequestRegistryState;
  registeredAt: number;
  terminal?: ToolRequestTerminalMetadata;
  promise: Promise<ToolResult>;
  resolve: (result: ToolResult) => void;
}

export class ToolRequestResolutionOwner {
  private active = true;

  constructor(private readonly entry: ToolRequestRegistryEntry) {}

  resolveSuccess(result: ToolResult): boolean {
    return this.resolveTerminal(result, 'success');
  }

  resolveFailure(result: ToolResult): boolean {
    return this.resolveTerminal(result, 'failure');
  }

  resolveInvalid(result: ToolResult): boolean {
    return this.resolveTerminal(result, 'invalid');
  }

  private resolveTerminal(result: ToolResult, outcome: ToolRequestTerminalOutcome): boolean {
    if (!this.active) {
      this.recordIgnoredCompletion();
      return false;
    }

    this.active = false;
    if (this.entry.state === 'resolved') {
      this.recordIgnoredCompletion();
      return false;
    }

    this.entry.state = 'resolved';
    this.entry.terminal = {
      outcome,
      resolvedAt: Date.now(),
      success: result.success,
      failureCode: result.error?.code,
      failureMessage: result.error?.message,
      ignoredCompletionCount: 0,
    };
    this.entry.resolve(result);
    return true;
  }

  recordIgnoredCompletion(): void {
    if (!this.entry.terminal) {
      return;
    }

    this.entry.terminal.ignoredCompletionCount += 1;
  }
}

export class ToolRequestRegistry {
  private readonly entries = new Map<string, ToolRequestRegistryEntry>();

  register(request: ToolRequest): ToolRequestRegistration {
    const existing = this.entries.get(request.toolRequestId);
    if (existing) {
      if (this.matchesIdentity(existing, request)) {
        return {
          kind: 'duplicate',
          promise: existing.promise,
          entry: this.snapshotEntry(existing),
        };
      }

      return {
        kind: 'conflict',
        entry: this.snapshotEntry(existing),
      };
    }

    let resolvePromise: (result: ToolResult) => void = () => undefined;
    const promise = new Promise<ToolResult>((resolve) => {
      resolvePromise = resolve;
    });

    const entry: ToolRequestRegistryEntry = {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      state: 'pending',
      registeredAt: Date.now(),
      promise,
      resolve: resolvePromise,
    };

    this.entries.set(request.toolRequestId, entry);
    return {
      kind: 'registered',
      promise,
      owner: new ToolRequestResolutionOwner(entry),
      entry: this.snapshotEntry(entry),
    };
  }

  inspect(): ToolRequestRegistrySnapshot {
    const snapshots = Array.from(this.entries.values())
      .sort((left, right) => left.registeredAt - right.registeredAt)
      .map((entry) => this.snapshotEntry(entry));

    return {
      pending: snapshots.filter((entry) => entry.state === 'pending'),
      recent: snapshots.filter((entry) => entry.state === 'resolved'),
    };
  }

  private matchesIdentity(entry: ToolRequestIdentitySnapshot, request: ToolRequest): boolean {
    return entry.toolRequestId === request.toolRequestId
      && entry.runId === request.runId
      && entry.workItemId === request.workItemId
      && entry.goalId === request.goalId
      && entry.toolCallId === request.toolCallId
      && entry.toolName === request.toolName;
  }

  private snapshotEntry(entry: ToolRequestRegistryEntry): ToolRequestRegistryEntrySnapshot {
    return {
      toolRequestId: entry.toolRequestId,
      runId: entry.runId,
      workItemId: entry.workItemId,
      goalId: entry.goalId,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      state: entry.state,
      registeredAt: entry.registeredAt,
      terminal: entry.terminal ? { ...entry.terminal } : undefined,
    };
  }
}
