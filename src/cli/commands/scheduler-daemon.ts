/**
 * Scheduler Daemon CLI Command
 *
 * Starts the Scheduler Daemon as a separate process that executes goals
 * and sends events to Gateway via IPC.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import net from 'node:net';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, openSync, closeSync } from 'fs';
import Database from 'better-sqlite3';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { getLLMService } from '../../infra/llm/index.js';
import { LLMRouter, MockLLMProvider } from '../../infra/llm/llm-provider.js';
import { createDefaultScheduler } from '../../scheduler/composition/index.js';
import { SchedulerDaemon } from '../../scheduler-daemon/daemon.js';
import { getGlobalSkillRegistry } from '../../infra/skills/skill-registry.js';
import { isDebugLoggingEnabled } from '../../infra/config/debug-flags.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { getManagedSkillsDir } from '../../infra/config/config-paths.js';
import { getAsciiArtBanner } from '../../infra/ui/ascii-art-banner.js';
import { getSchedulerConfiguredProviderIds } from '../lib/scheduler-provider-display.js';
import { LocalExecutionAdapter } from '../../runtime/execution-boundary/index.js';
import { LocalExecutionWorker } from '../../runtime/workers/index.js';
import type {
  EventedRunInspectionRecord,
  EventedRunReconciliationSummary,
  RunInspectionRecord,
} from '../../infra/persistence/repository-interface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PONY_DIR = join(homedir(), '.ponybunny');
const PID_FILE = join(PONY_DIR, 'scheduler.pid');
const LOG_FILE = join(PONY_DIR, 'scheduler.log');
const runtimeConfig = loadRuntimeConfig();

interface PidInfo {
  pid: number;
  startedAt: number;
  dbPath: string;
  memoryDbPath: string;
  socketPath: string;
  controlSocketPath?: string;
  mode: 'foreground' | 'background';
}

function ensurePonyDir(): void {
  if (!existsSync(PONY_DIR)) {
    mkdirSync(PONY_DIR, { recursive: true });
  }
}

function writePidFile(info: PidInfo): void {
  ensurePonyDir();
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

function readPidFile(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) {
      return null;
    }
    const content = readFileSync(PID_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore errors
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  ensurePonyDir();
  appendFileSync(LOG_FILE, line);
}

function ensureMemorySchema(db: Database.Database): void {
  try {
    const schemaPath = join(__dirname, '../../infra/persistence/schema-memory.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  } catch {
    try {
      const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema-memory.sql');
      const schema = readFileSync(distSchemaPath, 'utf-8');
      db.exec(schema);
    } catch {
    }
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function resolveSchedulerDbPath(dbPath?: string): string {
  if (dbPath) {
    return dbPath;
  }

  const pidInfo = readPidFile();
  return pidInfo?.dbPath ?? runtimeConfig.paths.database;
}

function resolveSchedulerControlSocketPath(pidInfo?: PidInfo | null): string {
  if (pidInfo?.controlSocketPath) {
    return pidInfo.controlSocketPath;
  }

  if (pidInfo?.socketPath) {
    return `${pidInfo.socketPath}.scheduler-control`;
  }

  return `${runtimeConfig.paths.schedulerSocket}.scheduler-control`;
}

async function withSchedulerRepository<T>(
  dbPath: string,
  action: (repository: WorkOrderDatabase) => T
): Promise<T> {
  const repository = new WorkOrderDatabase(dbPath);
  await repository.initialize();

  try {
    return action(repository);
  } finally {
    repository.close();
  }
}

function formatTimestamp(ms?: number): string {
  if (typeof ms !== 'number') {
    return '-';
  }

  return new Date(ms).toISOString();
}

function formatAgeFrom(ms?: number): string {
  if (typeof ms !== 'number') {
    return '-';
  }

  return formatUptime(Math.max(0, Date.now() - ms));
}

function formatOptional(value?: string | number | boolean): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }

  return String(value);
}

function getReplayLineageRole(
  record: RunInspectionRecord
): 'original' | 'replacement' | 'none' {
  if (record.replayOfRunId) {
    return 'replacement';
  }

  if (record.replayReplacementRunId) {
    return 'original';
  }

  return 'none';
}

function getReplayLineagePeerRunId(record: RunInspectionRecord): string | undefined {
  if (record.replayOfRunId) {
    return record.replayOfRunId;
  }

  return record.replayReplacementRunId;
}

type ReplayChainState =
  | 'replay_not_started'
  | 'replay_dispatched'
  | 'replay_in_progress'
  | 'replay_replacement_orphaned'
  | 'replay_result_applied'
  | 'replay_terminal_failed'
  | 'replay_terminal_unapplied'
  | 'replay_unresolved';

type ReplayChainOutcome = 'not_started' | 'active' | 'completed' | 'failed' | 'unresolved';
type ReplayOperatorPolicyState = 'none' | 'replacement_attempt_orphaned';
type ReplayOperatorPolicyReason = 'none' | 'replacement_attempt_stale_timeout';

interface ReplayChainDiagnostics {
  originalRecord?: RunInspectionRecord;
  replacementRecord?: RunInspectionRecord;
  replayInitiated: boolean;
  replacementRunExists: boolean;
  originalContinuationSuppressed: boolean;
  replacementRunActive?: boolean;
  replacementRunTerminal?: boolean;
  replacementResultContinuationApplied?: boolean;
  replayChainState: ReplayChainState;
  replayChainOutcome: ReplayChainOutcome;
  operatorPolicyState: ReplayOperatorPolicyState;
  operatorPolicyReason: ReplayOperatorPolicyReason;
  operatorNextStep: string;
}

function hasReplayDurableState(record: RunInspectionRecord): boolean {
  return (
    typeof record.replayOfRunId === 'string' ||
    typeof record.replayReplacementRunId === 'string' ||
    typeof record.replayRequestedAt === 'number' ||
    typeof record.replaySuppressedAt === 'number' ||
    typeof record.replayStartedAt === 'number'
  );
}

function isRunTerminal(record: RunInspectionRecord): boolean {
  return record.run.status !== 'running';
}

function deriveReplayChainDiagnostics(
  record: RunInspectionRecord,
  linkedRecord?: RunInspectionRecord
): ReplayChainDiagnostics {
  const replayLineageRole = getReplayLineageRole(record);
  const originalRecord =
    replayLineageRole === 'replacement' ? linkedRecord : hasReplayDurableState(record) ? record : undefined;
  const replacementRecord =
    replayLineageRole === 'original' ? linkedRecord : replayLineageRole === 'replacement' ? record : undefined;
  const replayInitiated =
    hasReplayDurableState(record) ||
    (linkedRecord ? hasReplayDurableState(linkedRecord) : false);
  const replacementRunExists =
    typeof replacementRecord?.run.id === 'string' ||
    typeof originalRecord?.replayReplacementRunId === 'string';
  const originalContinuationSuppressed = typeof originalRecord?.replaySuppressedAt === 'number';
  const replacementRunActive =
    replacementRecord?.run.status === 'running'
      ? true
      : replacementRecord
        ? false
        : undefined;
  const replacementRunTerminal =
    replacementRecord ? isRunTerminal(replacementRecord) : undefined;
  const replacementResultContinuationApplied = replacementRecord?.resultContinuationApplied;

  let replayChainState: ReplayChainState = 'replay_not_started';
  let replayChainOutcome: ReplayChainOutcome = 'not_started';
  let operatorPolicyState: ReplayOperatorPolicyState = 'none';
  let operatorPolicyReason: ReplayOperatorPolicyReason = 'none';
  let operatorNextStep = '-';

  if (!replayInitiated) {
    return {
      originalRecord,
      replacementRecord,
      replayInitiated,
      replacementRunExists,
      originalContinuationSuppressed,
      replacementRunActive,
      replacementRunTerminal,
      replacementResultContinuationApplied,
      replayChainState,
      replayChainOutcome,
      operatorPolicyState,
      operatorPolicyReason,
      operatorNextStep,
    };
  }

  if (!replacementRecord) {
    replayChainState =
      typeof originalRecord?.replayReplacementRunId === 'string' ||
      typeof record.replayOfRunId === 'string'
        ? 'replay_unresolved'
        : 'replay_dispatched';
    replayChainOutcome = replayChainState === 'replay_dispatched' ? 'active' : 'unresolved';
  } else if (replacementRecord.resultContinuationApplied) {
    replayChainState = 'replay_result_applied';
    replayChainOutcome = 'completed';
  } else if (
    replacementRecord.run.status === 'running' &&
    replacementRecord.orphanClassification === 'stale_timeout'
  ) {
    replayChainState = 'replay_replacement_orphaned';
    replayChainOutcome = 'unresolved';
    operatorPolicyState = 'replacement_attempt_orphaned';
    operatorPolicyReason = 'replacement_attempt_stale_timeout';
    operatorNextStep =
      'inspect the replacement attempt; do not replay it again; no automatic follow-up exists';
  } else if (replacementRecord.run.status === 'running') {
    replayChainState = 'replay_in_progress';
    replayChainOutcome = 'active';
  } else if (
    replacementRecord.run.status === 'failure' ||
    replacementRecord.run.status === 'timeout' ||
    replacementRecord.run.status === 'aborted'
  ) {
    replayChainState = 'replay_terminal_failed';
    replayChainOutcome = 'failed';
  } else if (replacementRecord.run.status === 'success') {
    replayChainState = 'replay_terminal_unapplied';
    replayChainOutcome = 'unresolved';
  } else {
    replayChainState = 'replay_unresolved';
    replayChainOutcome = 'unresolved';
  }

  return {
    originalRecord,
    replacementRecord,
    replayInitiated,
    replacementRunExists,
    originalContinuationSuppressed,
    replacementRunActive,
    replacementRunTerminal,
    replacementResultContinuationApplied,
    replayChainState,
    replayChainOutcome,
    operatorPolicyState,
    operatorPolicyReason,
    operatorNextStep,
  };
}

function printEventedInspectionRows(title: string, dbPath: string, rows: EventedRunInspectionRecord[]): void {
  console.log(chalk.bold(`\n${title}`));
  console.log(`- Database: ${dbPath}`);
  console.log(`- Count: ${rows.length}`);

  if (rows.length === 0) {
    console.log(chalk.yellow('- No matching runs found.'));
    return;
  }

  for (const row of rows) {
    console.log(
      `- runId=${row.run.id} goalId=${row.run.goal_id} workItemId=${row.run.work_item_id} ` +
      `runStatus=${row.run.status} workItemStatus=${row.workItemStatus} executionMode=${row.executionMode} ` +
      `lane=${formatOptional(row.laneId)} age=${formatAgeFrom(row.dispatchedAt)}`
    );
    console.log(
      `  dispatchedAt=${formatTimestamp(row.dispatchedAt)} resultContinuationApplied=${row.resultContinuationApplied} ` +
      `orphanClassification=${formatOptional(row.orphanClassification)} ` +
      `orphanDetectedAt=${formatTimestamp(row.orphanDetectedAt)}`
    );
  }
}

function printEventedSummary(dbPath: string, summary: EventedRunReconciliationSummary): void {
  console.log(chalk.bold('\nEvented Reconciliation Summary'));
  console.log(`- Database: ${dbPath}`);
  console.log(`- in_flight_evented: ${summary.inFlightEvented}`);
  console.log(`- stale_orphaned: ${summary.staleOrphaned}`);
  console.log(`- continuation_applied: ${summary.continuationApplied}`);
  console.log(`- already_terminal: ${summary.alreadyTerminal}`);
}

function printRunInspection(dbPath: string, record: RunInspectionRecord): void {
  const replayLineageRole = getReplayLineageRole(record);
  const replayLineagePeerRunId = getReplayLineagePeerRunId(record);

  console.log(chalk.bold('\nRun Inspection'));
  console.log(`- Database: ${dbPath}`);
  console.log(`- runId: ${record.run.id}`);
  console.log(`- goalId: ${record.run.goal_id}`);
  console.log(`- workItemId: ${record.run.work_item_id}`);
  console.log(`- runStatus: ${record.run.status}`);
  console.log(`- workItemStatus: ${record.workItemStatus}`);
  console.log(`- executionMode: ${record.executionMode}`);
  console.log(`- lane: ${formatOptional(record.laneId)}`);
  console.log(`- dispatchedAt: ${formatTimestamp(record.dispatchedAt)}`);
  console.log(`- age: ${formatAgeFrom(record.dispatchedAt)}`);
  console.log(`- resultContinuationApplied: ${record.resultContinuationApplied}`);
  console.log(`- resultContinuationAppliedAt: ${formatTimestamp(record.resultContinuationAppliedAt)}`);
  console.log(`- orphanClassification: ${formatOptional(record.orphanClassification)}`);
  console.log(`- orphanDetectedAt: ${formatTimestamp(record.orphanDetectedAt)}`);
  console.log(`- recoveryCandidate: ${formatOptional(record.recoveryCandidate)}`);
  console.log(`- recoveryCandidateMarkedAt: ${formatTimestamp(record.recoveryCandidateMarkedAt)}`);
  console.log(`- recoveryCandidateReason: ${formatOptional(record.recoveryCandidateReason)}`);
  console.log(`- replayCandidate: ${formatOptional(record.replayCandidate)}`);
  console.log(`- replayCandidateMarkedAt: ${formatTimestamp(record.replayCandidateMarkedAt)}`);
  console.log(`- replayCandidateReason: ${formatOptional(record.replayCandidateReason)}`);

  console.log('- Replay Lineage:');
  console.log(`- isReplayAttempt: ${record.replayOfRunId ? 'true' : 'false'}`);
  console.log(`- replayLineageRole: ${replayLineageRole}`);
  console.log(`- replayLineagePeerRunId: ${formatOptional(replayLineagePeerRunId)}`);
  console.log(`- replay_of_run_id: ${formatOptional(record.replayOfRunId)}`);
  console.log(`- replacement_run_id: ${formatOptional(record.replayReplacementRunId)}`);
  console.log(`- replayRequestedAt: ${formatTimestamp(record.replayRequestedAt)}`);
  console.log(
    `- original_continuation_suppressed_at: ${formatTimestamp(record.replaySuppressedAt)}`
  );
  console.log(`- replay_started_at: ${formatTimestamp(record.replayStartedAt)}`);
}

function printRunInspectionWithReplayOutcome(
  dbPath: string,
  record: RunInspectionRecord,
  linkedRecord?: RunInspectionRecord
): void {
  printRunInspection(dbPath, record);

  const diagnostics = deriveReplayChainDiagnostics(record, linkedRecord);
  const originalRecord = diagnostics.originalRecord;
  const replacementRecord = diagnostics.replacementRecord;
  const originalRunId = originalRecord?.run.id ?? replacementRecord?.replayOfRunId;
  const replacementRunId =
    replacementRecord?.run.id ?? originalRecord?.replayReplacementRunId;

  console.log('- Replay Outcome:');
  console.log(`- replayInitiated: ${diagnostics.replayInitiated ? 'yes' : 'no'}`);
  console.log(`- replacementRunExists: ${diagnostics.replacementRunExists ? 'yes' : 'no'}`);
  console.log(
    `- originalContinuationSuppressed: ${
      diagnostics.originalRecord ? (diagnostics.originalContinuationSuppressed ? 'yes' : 'no') : '-'
    }`
  );
  console.log(`- replayChainState: ${diagnostics.replayChainState}`);
  console.log(`- replayChainOutcome: ${diagnostics.replayChainOutcome}`);
  console.log(`- operatorPolicyState: ${diagnostics.operatorPolicyState}`);
  console.log(`- operatorPolicyReason: ${diagnostics.operatorPolicyReason}`);
  console.log(`- operatorNextStep: ${diagnostics.operatorNextStep}`);
  console.log(`- originalRunId: ${formatOptional(originalRunId)}`);
  console.log(`- originalGoalId: ${formatOptional(originalRecord?.run.goal_id)}`);
  console.log(`- originalWorkItemId: ${formatOptional(originalRecord?.run.work_item_id)}`);
  console.log(`- originalRunStatus: ${formatOptional(originalRecord?.run.status)}`);
  console.log(
    `- originalWorkItemStatus: ${formatOptional(originalRecord?.workItemStatus)}`
  );
  console.log(
    `- originalContinuationSuppressedAt: ${formatTimestamp(originalRecord?.replaySuppressedAt)}`
  );
  console.log(`- replacementRunId: ${formatOptional(replacementRunId)}`);
  console.log(`- replacementGoalId: ${formatOptional(replacementRecord?.run.goal_id)}`);
  console.log(
    `- replacementWorkItemId: ${formatOptional(replacementRecord?.run.work_item_id)}`
  );
  console.log(`- replacementRunStatus: ${formatOptional(replacementRecord?.run.status)}`);
  console.log(
    `- replacementWorkItemStatus: ${formatOptional(replacementRecord?.workItemStatus)}`
  );
  console.log(
    `- replacementExecutionMode: ${formatOptional(replacementRecord?.executionMode)}`
  );
  console.log(`- replacementDispatchedAt: ${formatTimestamp(replacementRecord?.dispatchedAt)}`);
  console.log(`- replacementAge: ${formatAgeFrom(replacementRecord?.dispatchedAt)}`);
  console.log(
    `- replacementRunActive: ${
      diagnostics.replacementRunActive === undefined
        ? '-'
        : diagnostics.replacementRunActive
          ? 'yes'
          : 'no'
    }`
  );
  console.log(
    `- replacementRunTerminal: ${
      diagnostics.replacementRunTerminal === undefined
        ? '-'
        : diagnostics.replacementRunTerminal
          ? 'yes'
          : 'no'
    }`
  );
  console.log(
    `- replacementResultContinuationApplied: ${
      diagnostics.replacementResultContinuationApplied === undefined
        ? '-'
        : diagnostics.replacementResultContinuationApplied
          ? 'yes'
          : 'no'
    }`
  );
  console.log(
    `- replacementResultContinuationAppliedAt: ${formatTimestamp(
      replacementRecord?.resultContinuationAppliedAt
    )}`
  );
}

function describeReplayRunRejection(
  status:
    | 'eligible'
    | 'replay_started'
    | 'run_not_found'
    | 'missing_evented_dispatch'
    | 'already_applied'
    | 'already_terminal'
    | 'work_item_not_in_progress'
    | 'recovery_candidate_required'
    | 'replay_candidate_required'
    | 'missing_orphan_classification'
    | 'already_replayed'
    | 'replay_attempt_not_allowed'
    | 'not_evented_execution'
): string {
  switch (status) {
    case 'eligible':
      return 'run is eligible for manual replay';
    case 'replay_started':
      return 'replay started';
    case 'run_not_found':
      return 'run was not found';
    case 'missing_evented_dispatch':
      return 'run does not have an eligible evented dispatch checkpoint';
    case 'already_applied':
      return 'run already applied its scheduler continuation';
    case 'already_terminal':
      return 'run is no longer running';
    case 'work_item_not_in_progress':
      return 'work item is no longer in_progress';
    case 'recovery_candidate_required':
      return 'run is missing the recovery candidate marker';
    case 'replay_candidate_required':
      return 'run is missing the replay candidate marker';
    case 'missing_orphan_classification':
      return 'run is missing orphan classification required for replay';
    case 'already_replayed':
      return 'run already has replay lineage or a replacement run';
    case 'replay_attempt_not_allowed':
      return 'replay attempts cannot themselves be replayed';
    case 'not_evented_execution':
      return 'scheduler is not running in evented execution mode';
  }
}

function printReplayPrecheck(
  runId: string,
  result: {
    eligible: boolean;
    rejectionReasons: string[];
    expectedConsequences: string[];
  }
): void {
  console.log('Replay Precheck');
  console.log(`- runId: ${runId}`);
  console.log(`- eligible: ${result.eligible ? 'yes' : 'no'}`);

  if (result.rejectionReasons.length > 0) {
    console.log('- rejectionCodes:');
    for (const code of result.rejectionReasons) {
      console.log(`  - ${code}: ${describeReplayRunRejection(code as Parameters<typeof describeReplayRunRejection>[0])}`);
    }
  } else {
    console.log('- rejectionCodes: none');
  }

  if (result.expectedConsequences.length > 0) {
    console.log('- expectedConsequences:');
    for (const consequence of result.expectedConsequences) {
      console.log(`  - ${consequence}`);
    }
  } else {
    console.log('- expectedConsequences: none');
  }
}

async function createReplayScheduler(dbPath: string) {
  const repository = new WorkOrderDatabase(dbPath);
  await repository.initialize();

  const llmService = getLLMService();
  const availableProviders = llmService.getAvailableProviders();
  const llmProvider =
    availableProviders.length === 0
      ? new LLMRouter([new MockLLMProvider('mock-provider')])
      : llmService;

  const skillRegistry = getGlobalSkillRegistry();
  await skillRegistry.loadSkills({
    workspaceDir: process.cwd(),
    managedSkillsDir: getManagedSkillsDir(),
  });

  const executionService = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, llmProvider);
  await executionService.initializeSkills(process.cwd());
  await executionService.initializeMCP();

  const executionPort = new LocalExecutionAdapter(executionService);
  const executionWorker = new LocalExecutionWorker(executionPort);
  executionWorker.start();

  const scheduler = createDefaultScheduler(
    {
      repository,
      executionService,
      llmProvider,
      executionPort,
    },
    {
      tickIntervalMs: runtimeConfig.scheduler.tickIntervalMs,
      maxConcurrentGoals: runtimeConfig.scheduler.maxConcurrentGoals,
      autoStart: false,
      debug: isDebugLoggingEnabled(),
      executionMode: runtimeConfig.scheduler.executionMode,
      deterministicRuntimeEnabled: runtimeConfig.scheduler.deterministicRuntimeEnabled,
      planCompilerEnabled: runtimeConfig.scheduler.planCompilerEnabled,
      toolRoutingMode: runtimeConfig.scheduler.toolRoutingMode,
      runtimeRollout: runtimeConfig.scheduler.runtimeRollout,
    }
  );

  return {
    repository,
    executionWorker,
    scheduler,
  };
}

async function replayRunViaActiveDaemon(
  controlSocketPath: string,
  runId: string
): Promise<{
  status:
    | 'replay_started'
    | 'run_not_found'
    | 'missing_evented_dispatch'
    | 'already_applied'
    | 'already_terminal'
    | 'work_item_not_in_progress'
    | 'recovery_candidate_required'
    | 'replay_candidate_required'
    | 'missing_orphan_classification'
    | 'already_replayed'
    | 'replay_attempt_not_allowed'
    | 'not_evented_execution';
  originalRun?: { id: string };
  replacementRun?: { id: string };
}> {
  const requestId = `scheduler-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(controlSocketPath);
    let buffer = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error(`Timed out waiting for scheduler daemon replay response on ${controlSocketPath}`));
    }, 5000);

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.end();
      callback();
    };

    socket.on('connect', () => {
      socket.write(
        `${JSON.stringify({
          type: 'scheduler_command',
          timestamp: Date.now(),
          data: {
            requestId,
            command: 'replay_run',
            runId,
          },
        })}\n`
      );
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');

        if (!line.trim()) {
          continue;
        }

        try {
          const message = JSON.parse(line) as {
            type?: string;
            data?: {
              requestId?: string;
              success?: boolean;
              error?: string;
              result?: unknown;
            };
          };

          if (
            message.type !== 'scheduler_command_result' ||
            message.data?.requestId !== requestId
          ) {
            continue;
          }

          finish(() => {
            if (message.data?.success) {
              resolve((message.data.result ?? {}) as Awaited<ReturnType<typeof replayRunViaActiveDaemon>>);
              return;
            }

            reject(
              new Error(
                typeof message.data?.error === 'string'
                  ? message.data.error
                  : 'Scheduler daemon replay request failed'
              )
            );
          });
          return;
        } catch (error) {
          finish(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
          return;
        }
      }
    });

    socket.on('error', (error) => {
      finish(() => {
        reject(error);
      });
    });

    socket.on('close', () => {
      if (settled) {
        return;
      }

      finish(() => {
        reject(new Error(`Scheduler daemon control socket closed before replying: ${controlSocketPath}`));
      });
    });
  });
}

async function runScheduler(
  dbPath: string,
  memoryDbPath: string,
  socketPath: string,
  debugMode: boolean,
  mode: 'foreground' | 'background',
  agentsEnabled: boolean,
  mainAgentId: string,
  personaEnabled: boolean
): Promise<void> {
  const isBackground = process.env.PONY_SCHEDULER_BACKGROUND === '1';
  let memoryDb: Database.Database | null = null;

  log(`Scheduler starting with db=${dbPath}, socket=${socketPath}, agentsEnabled=${agentsEnabled}`);

  try {
    // Initialize database
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    memoryDb = new Database(memoryDbPath);
    ensureMemorySchema(memoryDb);

    // Initialize LLM service
    const llmService = getLLMService();
    const availableProviders = llmService.getAvailableProviders();
    const configuredProviders = getSchedulerConfiguredProviderIds();
    const providerBannerList = configuredProviders.length > 0
      ? configuredProviders
      : availableProviders;

    let llmProvider;
    if (availableProviders.length === 0) {
      log('No API keys found. Using Mock LLM Provider.');
      if (!isBackground) {
        console.warn(chalk.yellow('[SchedulerDaemon] No API keys found. Using Mock LLM Provider.'));
      }
      llmProvider = new LLMRouter([new MockLLMProvider('mock-provider')]);
    } else {
      llmProvider = llmService;
      if (!isBackground) {
        console.log(chalk.gray(`  LLM Providers: ${providerBannerList.join(', ')}`));
      }
    }

    // Initialize Skill Registry (for enhanced execution capabilities)
    const skillRegistry = getGlobalSkillRegistry();
    const managedSkillsDir = getManagedSkillsDir();

    await skillRegistry.loadSkills({
      workspaceDir: process.cwd(),
      managedSkillsDir,
    });

    const loadedSkills = skillRegistry.getSkills();
    if (!isBackground && loadedSkills.length > 0) {
      console.log(chalk.gray(`  Skills Loaded: ${loadedSkills.length}`));
    }
    log(`Loaded ${loadedSkills.length} skills`);

    // Create execution service with enhanced capabilities
    const executionService = new ExecutionService(
      repository,
      { maxConsecutiveErrors: 3 },
      llmProvider
    );

    // Initialize skills for execution service
    await executionService.initializeSkills(process.cwd());

    // Initialize MCP integration (connect to external tool servers)
    await executionService.initializeMCP();

    // Create scheduler daemon
    const tickIntervalMs = runtimeConfig.scheduler.tickIntervalMs;
    const maxConcurrentGoals = runtimeConfig.scheduler.maxConcurrentGoals;
    const controlSocketPath = `${socketPath}.scheduler-control`;

    const daemon = new SchedulerDaemon(
      repository,
      executionService,
      llmProvider,
      {
        ipcSocketPath: socketPath,
        controlSocketPath,
        dbPath,
        debug: debugMode,
        tickIntervalMs,
        maxConcurrentGoals,
        executionMode: runtimeConfig.scheduler.executionMode,
        deterministicRuntimeEnabled: runtimeConfig.scheduler.deterministicRuntimeEnabled,
        planCompilerEnabled: runtimeConfig.scheduler.planCompilerEnabled,
        toolRoutingMode: runtimeConfig.scheduler.toolRoutingMode,
        runtimeRollout: runtimeConfig.scheduler.runtimeRollout,
        eventedOrphanTimeoutMs: runtimeConfig.scheduler.eventedOrphanTimeoutMs,
        runEventRetention: runtimeConfig.scheduler.runEventRetention,
        agentsEnabled,
        mainAgentId,
        personaEnabled,
        memoryDb,
        runtimeToolingContext: executionService.getRuntimeToolingContext(),
      }
    );

    // Handle shutdown signals
    const shutdown = async () => {
      log('Scheduler shutting down...');
      if (!isBackground) {
        console.log(chalk.yellow('\n[SchedulerDaemon] Shutting down gracefully...'));
      }
      removePidFile();
      await daemon.stop();
      log('Scheduler stopped');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start daemon
    await daemon.start();

    // Write PID file
    writePidFile({
      pid: process.pid,
      startedAt: Date.now(),
      dbPath,
      memoryDbPath,
      socketPath,
      controlSocketPath,
      mode,
    });

    const bannerSeparator = '═══════════════════════════════════════════════════════';
    console.log(bannerSeparator);
    const asciiArt = getAsciiArtBanner(bannerSeparator.length);
    if (asciiArt) {
      console.log(asciiArt);
    }
    console.log('⚙️  PonyBunny Scheduler Daemon Started');
    console.log(bannerSeparator);
    console.log(`  PID: ${process.pid}`);
    console.log(`  Database: ${dbPath}`);
    console.log(`  IPC Socket: ${socketPath}`);
    console.log(`  Control Socket: ${controlSocketPath}`);
    console.log(`  Tick Interval: ${tickIntervalMs}ms`);
    console.log(`  Max Concurrent Goals: ${maxConcurrentGoals}`);
    console.log(`  Execution Mode: ${runtimeConfig.scheduler.executionMode}`);
    console.log(`  Deterministic Runtime: ${runtimeConfig.scheduler.deterministicRuntimeEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  Plan Compiler: ${runtimeConfig.scheduler.planCompilerEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  Tool Routing Mode: ${runtimeConfig.scheduler.toolRoutingMode}`);
    console.log(`  Debug Mode: ${debugMode ? 'Enabled' : 'Disabled'}`);
    console.log(`  Agent Scheduler: ${agentsEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  Main Agent: ${mainAgentId}`);
    console.log(`  Persona: ${personaEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(
      `  LLM Providers: ${providerBannerList.length > 0 ? providerBannerList.join(', ') : 'mock-provider'}`
    );
    console.log(`  Skills Loaded: ${loadedSkills.length}`);
    console.log(`${bannerSeparator}\n`);

    log(`Scheduler started successfully (PID: ${process.pid})`);

    if (!isBackground) {
      console.log(chalk.green('\n✓ Scheduler Daemon started successfully'));
      console.log(chalk.gray('  Press Ctrl+C to stop\n'));
    }

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    if (memoryDb) {
      memoryDb.close();
      memoryDb = null;
    }
    log(`Scheduler failed to start: ${error}`);
    removePidFile();
    if (!isBackground) {
      console.error(chalk.red('Failed to start Scheduler Daemon:'), error);
    }
    process.exit(1);
  }
}

function startBackground(
  dbPath: string,
  memoryDbPath: string,
  socketPath: string,
  debugMode: boolean,
  agentsEnabled: boolean,
  mainAgentId: string,
  personaEnabled: boolean
): void {
  console.log(chalk.blue('Starting Scheduler Daemon in background...'));

  const cliPath = join(__dirname, '../index.js');

  // Open log file for output
  ensurePonyDir();
  const logFd = openSync(LOG_FILE, 'a');

  const args = [
    cliPath,
    'scheduler',
    'start',
    '--foreground',
    '--db',
    dbPath,
    '--memory-db',
    memoryDbPath,
    '--socket',
    socketPath,
  ];
  if (debugMode) {
    args.push('--debug');
  }
  if (agentsEnabled) {
    args.push('--agents');
  }
  if (mainAgentId) {
    args.push('--main-agent', mainAgentId);
  }
  if (personaEnabled) {
    args.push('--persona');
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PONY_SCHEDULER_BACKGROUND: '1' },
  });

  child.unref();
  closeSync(logFd);

  // Wait a bit and check if it started
  setTimeout(() => {
    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      console.log(chalk.green(`\n✓ Scheduler started in background`));
      console.log(chalk.gray(`  PID: ${pidInfo.pid}`));
      console.log(chalk.gray(`  Database: ${dbPath}`));
      console.log(chalk.gray(`  Memory DB: ${memoryDbPath}`));
      console.log(chalk.gray(`  Socket: ${socketPath}`));
      console.log(chalk.gray(`  Control Socket: ${pidInfo.controlSocketPath ?? `${pidInfo.socketPath}.scheduler-control`}`));
      console.log(chalk.gray(`  Log: ${LOG_FILE}`));
      console.log(chalk.gray('\nUse `pb scheduler stop` to stop the daemon'));
    } else {
      console.log(chalk.red('Failed to start scheduler. Check logs:'));
      console.log(chalk.gray(`  ${LOG_FILE}`));
      process.exit(1);
    }
  }, 1500);
}

export const schedulerCommand = new Command('scheduler')
  .description('Manage the Scheduler Daemon')
  .addCommand(
    new Command('start')
      .description('Start the Scheduler Daemon')
      .option('--foreground', 'Run in foreground (default: background)')
      .option('--db <path>', 'Database path', runtimeConfig.paths.database)
      .option('--memory-db <path>', 'Conversation memory/session sqlite path', runtimeConfig.memory.database)
      .option('--socket <path>', 'IPC socket path', runtimeConfig.paths.schedulerSocket)
      .option('--debug', 'Enable debug mode')
      .option('-f, --force', 'Force start even if already running')
      .option('--agents', 'Enable config-driven agent scheduler loop', runtimeConfig.scheduler.agentsEnabled)
      .option('--main-agent <id>', 'Main agent to load and run', runtimeConfig.agent.mainAgentId)
      .option('--persona', 'Enable persona prompt loading', runtimeConfig.agent.personaEnabled)
      .action(async (options) => {
        const dbPath = options.db;
        const memoryDbPath = options.memoryDb;
        const socketPath = options.socket;
        const debugMode = Boolean(options.debug) || isDebugLoggingEnabled();
        const foreground = options.foreground ?? false;
        const force = options.force ?? false;
        const agentsEnabled = options.agents ?? runtimeConfig.scheduler.agentsEnabled;
        const mainAgentId = options.mainAgent ?? runtimeConfig.agent.mainAgentId;
        const personaEnabled = options.persona ?? runtimeConfig.agent.personaEnabled;

        // Check if scheduler is already running
        const existingPid = readPidFile();
        if (existingPid && isProcessRunning(existingPid.pid)) {
          if (!force) {
            console.log(chalk.yellow('⚠ Scheduler is already running'));
            console.log(chalk.gray(`  PID: ${existingPid.pid}`));
            console.log(chalk.gray(`  Started: ${new Date(existingPid.startedAt).toISOString()}`));
            console.log(chalk.gray('\nUse --force to start anyway, or run `pb scheduler stop` first'));
            process.exit(1);
          }
          console.log(chalk.yellow('⚠ Stopping existing scheduler process...'));
          killProcess(existingPid.pid);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Clean up stale PID files
        removePidFile();

        if (foreground) {
          // Run in foreground
          await runScheduler(
            dbPath,
            memoryDbPath,
            socketPath,
            debugMode,
            'foreground',
            agentsEnabled,
            mainAgentId,
            personaEnabled
          );
        } else {
          // Run in background (default)
          startBackground(dbPath, memoryDbPath, socketPath, debugMode, agentsEnabled, mainAgentId, personaEnabled);
        }
      })
  )
  .addCommand(
    new Command('stop')
      .description('Stop the Scheduler Daemon')
      .option('-f, --force', 'Force kill with SIGKILL')
      .action(async (options) => {
        const { force } = options;

        const pidInfo = readPidFile();
        if (!pidInfo || !isProcessRunning(pidInfo.pid)) {
          console.log(chalk.yellow('Scheduler is not running'));
          removePidFile();
          process.exit(0);
        }

        const signal = force ? 'SIGKILL' : 'SIGTERM';

        console.log(chalk.blue(`Stopping Scheduler (PID: ${pidInfo.pid})...`));

        if (killProcess(pidInfo.pid, signal)) {
          // Wait for process to stop
          let attempts = 0;
          const maxAttempts = force ? 5 : 30;

          while (attempts < maxAttempts && isProcessRunning(pidInfo.pid)) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }

          if (isProcessRunning(pidInfo.pid)) {
            if (!force) {
              console.log(chalk.yellow('Process did not stop gracefully, use --force to kill'));
              process.exit(1);
            } else {
              console.log(chalk.red('Failed to kill process'));
              process.exit(1);
            }
          }
        } else {
          console.log(chalk.red('Failed to send signal to process'));
          process.exit(1);
        }

        removePidFile();
        console.log(chalk.green('✓ Scheduler stopped'));
      })
  )
  .addCommand(
    new Command('status')
      .description('Check Scheduler Daemon status')
      .action(() => {
        const pidInfo = readPidFile();

        if (!pidInfo) {
          console.log(chalk.yellow('No Scheduler process found'));
          return;
        }

        const running = isProcessRunning(pidInfo.pid);

        console.log(chalk.blue('\nScheduler Daemon Status:\n'));
        console.log(chalk.white('  Status:'), running ? chalk.green('Running') : chalk.red('Not Running'));
        console.log(chalk.white('  PID:'), chalk.cyan(pidInfo.pid));
        console.log(chalk.white('  Mode:'), chalk.cyan(pidInfo.mode));
        console.log(chalk.white('  Database:'), chalk.gray(pidInfo.dbPath));
        console.log(chalk.white('  Memory DB:'), chalk.gray(pidInfo.memoryDbPath));
        console.log(chalk.white('  Socket:'), chalk.gray(pidInfo.socketPath));
        console.log(chalk.white('  Started:'), chalk.gray(new Date(pidInfo.startedAt).toISOString()));

        if (running) {
          console.log(chalk.white('  Uptime:'), chalk.gray(formatUptime(Date.now() - pidInfo.startedAt)));
        }

        console.log(chalk.white('  Log file:'), chalk.gray(LOG_FILE));

        if (!running) {
          console.log(chalk.yellow('\n⚠ Process is not running but PID file exists'));
          console.log(chalk.gray('  Run `pb scheduler start` to start a new instance'));
        }
        console.log();
      })
  )
  .addCommand(
    new Command('inspect-run')
      .description('Inspect one durable run record for manual recovery review')
      .argument('<runId>', 'Run ID to inspect')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (runId: string, options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const inspection = await withSchedulerRepository(dbPath, (repository) => {
          const record = repository.getRunInspection(runId);
          if (!record) {
            return undefined;
          }

          const peerRunId = getReplayLineagePeerRunId(record);
          const peerRecord = peerRunId ? repository.getRunInspection(peerRunId) : undefined;

          return {
            record,
            peerRecord,
          };
        });

        if (!inspection) {
          console.log(chalk.red(`Run not found: ${runId}`));
          process.exit(1);
        }

        printRunInspectionWithReplayOutcome(dbPath, inspection.record, inspection.peerRecord);
      })
  )
  .addCommand(
    new Command('in-flight')
      .description('Inspect durable evented in-flight reconciliation records')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const rows = await withSchedulerRepository(dbPath, (repository) =>
          repository.listEventedInFlightRunInspections()
        );
        printEventedInspectionRows('Evented In-Flight Runs', dbPath, rows);
      })
  )
  .addCommand(
    new Command('orphaned')
      .description('Inspect stale/orphan-marked evented runs')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const rows = await withSchedulerRepository(dbPath, (repository) =>
          repository.listEventedOrphanedRunInspections()
        );
        printEventedInspectionRows('Evented Orphaned Runs', dbPath, rows);
      })
  )
  .addCommand(
    new Command('reconciliation-summary')
      .description('Show a narrow evented reconciliation count summary')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const summary = await withSchedulerRepository(dbPath, (repository) =>
          repository.getEventedRunReconciliationSummary()
        );
        printEventedSummary(dbPath, summary);
      })
  )
  .addCommand(
    new Command('mark-recovery-candidate')
      .description('Durably mark one evented run as a manual recovery candidate')
      .argument('<runId>', 'Run ID to mark')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (runId: string, options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const result = await withSchedulerRepository(dbPath, (repository) =>
          repository.markEventedRunRecoveryCandidate(runId)
        );

        if (result.status === 'marked') {
          console.log(chalk.green(`Recovery candidate marked for run ${runId}.`));
        } else if (result.status === 'already_marked') {
          console.log(chalk.yellow(`Recovery candidate already marked for run ${runId}.`));
        } else if (result.status === 'run_not_found') {
          console.log(chalk.red(`Run not found: ${runId}`));
          process.exit(1);
        } else {
          console.log(
            chalk.red(
              `Could not mark run ${runId} as a recovery candidate (${result.status}).`
            )
          );
          if (result.run) {
            const record = await withSchedulerRepository(dbPath, (repository) =>
              repository.getRunInspection(runId)
            );
            if (record) {
              printRunInspection(dbPath, record);
            }
          }
          process.exit(1);
        }

        const record = await withSchedulerRepository(dbPath, (repository) =>
          repository.getRunInspection(runId)
        );
        if (record) {
          printRunInspection(dbPath, record);
        }
      })
  )
  .addCommand(
    new Command('mark-replay-candidate')
      .description('Durably mark one recovery-candidate evented run as a replay candidate')
      .argument('<runId>', 'Run ID to mark')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (runId: string, options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const result = await withSchedulerRepository(dbPath, (repository) =>
          repository.markEventedRunReplayCandidate(runId)
        );

        if (result.status === 'marked') {
          console.log(chalk.green(`Replay candidate marked for run ${runId}.`));
        } else if (result.status === 'already_marked') {
          console.log(chalk.yellow(`Replay candidate already marked for run ${runId}.`));
        } else if (result.status === 'run_not_found') {
          console.log(chalk.red(`Run not found: ${runId}`));
          process.exit(1);
        } else {
          console.log(
            chalk.red(
              `Could not mark run ${runId} as a replay candidate (${result.status}).`
            )
          );
          if (result.run) {
            const record = await withSchedulerRepository(dbPath, (repository) =>
              repository.getRunInspection(runId)
            );
            if (record) {
              printRunInspection(dbPath, record);
            }
          }
          process.exit(1);
        }

        const record = await withSchedulerRepository(dbPath, (repository) =>
          repository.getRunInspection(runId)
        );
        if (record) {
          printRunInspection(dbPath, record);
        }
      })
  )
  .addCommand(
    new Command('clear-recovery-candidate')
      .description('Durably clear one evented run manual recovery candidate marker')
      .argument('<runId>', 'Run ID to clear')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (runId: string, options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const result = await withSchedulerRepository(dbPath, (repository) =>
          repository.clearEventedRunRecoveryCandidate(runId)
        );

        if (result.status === 'cleared') {
          console.log(chalk.green(`Recovery candidate cleared for run ${runId}.`));
        } else if (result.status === 'already_cleared') {
          console.log(chalk.yellow(`Recovery candidate already cleared for run ${runId}.`));
        } else if (result.status === 'run_not_found') {
          console.log(chalk.red(`Run not found: ${runId}`));
          process.exit(1);
        } else {
          console.log(
            chalk.red(
              `Could not clear recovery candidate for run ${runId} (${result.status}).`
            )
          );
          if (result.run) {
            const record = await withSchedulerRepository(dbPath, (repository) =>
              repository.getRunInspection(runId)
            );
            if (record) {
              printRunInspection(dbPath, record);
            }
          }
          process.exit(1);
        }

        const record = await withSchedulerRepository(dbPath, (repository) =>
          repository.getRunInspection(runId)
        );
        if (record) {
          printRunInspection(dbPath, record);
        }
      })
  )
  .addCommand(
    new Command('replay-precheck')
      .description('Inspect whether a run is eligible for manual replay without executing replay')
      .argument('<runId>', 'Run ID to precheck for manual replay')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (runId: string, options: { db?: string }) => {
        const dbPath = resolveSchedulerDbPath(options.db);
        const result =
          runtimeConfig.scheduler.executionMode !== 'evented'
            ? {
                status: 'not_evented_execution',
                eligible: false,
                rejectionReasons: ['not_evented_execution'],
                expectedConsequences: [],
              }
            : await withSchedulerRepository(dbPath, (repository) =>
                repository.precheckEventedManualReplay(runId)
              );

        printReplayPrecheck(runId, result);

        const record = await withSchedulerRepository(dbPath, (repository) =>
          repository.getRunInspection(runId)
        );
        if (record) {
          printRunInspection(dbPath, record);
        }

        if (!result.eligible) {
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('replay-run')
      .description('Create one replacement run for an eligible orphaned evented run and dispatch it')
      .argument('<runId>', 'Run ID to replay')
      .option('--db <path>', 'Database path (defaults to running scheduler DB or configured path)')
      .action(async (runId: string, options: { db?: string }) => {
        const runningScheduler = readPidFile();
        if (runningScheduler && isProcessRunning(runningScheduler.pid)) {
          const dbPath = resolveSchedulerDbPath(options.db);
          const controlSocketPath = resolveSchedulerControlSocketPath(runningScheduler);
          const result = await replayRunViaActiveDaemon(controlSocketPath, runId);

          if (result.status !== 'replay_started' || !result.replacementRun) {
            console.log(
              chalk.red(
                `Could not replay run ${runId} (${result.status}: ${describeReplayRunRejection(result.status)}).`
              )
            );
            const record = await withSchedulerRepository(dbPath, (repo) => repo.getRunInspection(runId));
            if (record) {
              printRunInspection(dbPath, record);
            }
            process.exit(1);
          }

          console.log(
            chalk.green(
              `Replay started for run ${runId}. Replacement run: ${result.replacementRun.id}`
            )
          );

          const originalRecord = await withSchedulerRepository(dbPath, (repo) =>
            repo.getRunInspection(runId)
          );
          if (originalRecord) {
            printRunInspection(dbPath, originalRecord);
          }

          const replacementRecord = await withSchedulerRepository(dbPath, (repo) =>
            repo.getRunInspection(result.replacementRun!.id)
          );
          if (replacementRecord) {
            printRunInspection(dbPath, replacementRecord);
          }
          return;
        }

        const dbPath = resolveSchedulerDbPath(options.db);
        const { repository, executionWorker, scheduler } = await createReplayScheduler(dbPath);

        try {
          const result = await scheduler.replayRun(runId);

          if (result.status !== 'replay_started' || !result.replacementRun) {
            console.log(
              chalk.red(
                `Could not replay run ${runId} (${result.status}: ${describeReplayRunRejection(result.status)}).`
              )
            );
            const record = await withSchedulerRepository(dbPath, (repo) => repo.getRunInspection(runId));
            if (record) {
              printRunInspection(dbPath, record);
            }
            process.exit(1);
          }

          console.log(
            chalk.green(
              `Replay started for run ${runId}. Replacement run: ${result.replacementRun.id}`
            )
          );

          const originalRecord = await withSchedulerRepository(dbPath, (repo) =>
            repo.getRunInspection(runId)
          );
          if (originalRecord) {
            printRunInspection(dbPath, originalRecord);
          }

          const replacementRecord = await withSchedulerRepository(dbPath, (repo) =>
            repo.getRunInspection(result.replacementRun!.id)
          );
          if (replacementRecord) {
            printRunInspection(dbPath, replacementRecord);
          }
        } finally {
          executionWorker.stop();
          repository.close();
        }
      })
  )
  .addCommand(
    new Command('logs')
      .description('Show Scheduler logs')
      .option('-f, --follow', 'Follow log output')
      .option('-n, --lines <n>', 'Number of lines to show', '50')
      .action(async (options) => {
        const { follow, lines } = options;

        if (!existsSync(LOG_FILE)) {
          console.log(chalk.yellow('No log file found'));
          process.exit(0);
        }

        if (follow) {
          const tail = spawn('tail', ['-f', LOG_FILE], {
            stdio: 'inherit',
          });

          process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
          });
        } else {
          try {
            const output = execSync(`tail -n ${lines} "${LOG_FILE}"`, { encoding: 'utf-8' });
            console.log(output);
          } catch {
            console.log(chalk.red('Failed to read log file'));
          }
        }
      })
  );
