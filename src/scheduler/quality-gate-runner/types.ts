/**
 * Quality Gate Runner Types
 */

import type { QualityGate, WorkItem, Run } from '../../work-order/types/index.js';

export interface QualityGateResult {
  gateName: string;
  gateType: QualityGate['type'];
  passed: boolean;
  required: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs: number;
}

export interface VerificationResult {
  workItemId: string;
  runId: string;
  allPassed: boolean;
  requiredPassed: boolean;
  results: QualityGateResult[];
  summary: string;
  totalDurationMs: number;
}

export interface QualityGateRunnerConfig {
  /** Timeout for deterministic gates (commands) in ms */
  commandTimeoutMs: number;
  /** Timeout for LLM review gates in ms */
  llmTimeoutMs: number;
  /** Whether to continue running gates after a required gate fails */
  continueOnRequiredFailure: boolean;
  /** Maximum concurrent gate executions */
  maxConcurrency: number;
}

export interface IQualityGateRunner {
  /** Run all quality gates for a work item */
  runVerification(workItem: WorkItem, run: Run): Promise<VerificationResult>;

  /** Run a single quality gate */
  runGate(gate: QualityGate): Promise<QualityGateResult>;

  /** Get runner configuration */
  getConfig(): QualityGateRunnerConfig;

  /** Update runner configuration */
  updateConfig(config: Partial<QualityGateRunnerConfig>): void;
}

export interface ICommandExecutor {
  /** Execute a shell command and return result */
  execute(
    command: string,
    options?: { timeoutMs?: number; cwd?: string }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface ILLMReviewer {
  /** Run an LLM review with the given prompt */
  review(prompt: string, context?: Record<string, unknown>): Promise<{
    passed: boolean;
    reasoning: string;
  }>;
}
