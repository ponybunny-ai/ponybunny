/**
 * Quality Gate Runner Implementation
 *
 * Runs verification quality gates for work items to ensure
 * the work meets acceptance criteria before completion.
 */

import type { QualityGate, WorkItem, Run } from '../../work-order/types/index.js';
import type {
  IQualityGateRunner,
  ICommandExecutor,
  ILLMReviewer,
  QualityGateResult,
  VerificationResult,
  QualityGateRunnerConfig,
} from './types.js';

const DEFAULT_CONFIG: QualityGateRunnerConfig = {
  commandTimeoutMs: 60000, // 1 minute
  llmTimeoutMs: 120000, // 2 minutes
  continueOnRequiredFailure: false,
  maxConcurrency: 3,
};

/**
 * Default command executor using child_process
 */
export class DefaultCommandExecutor implements ICommandExecutor {
  async execute(
    command: string,
    options?: { timeoutMs?: number; cwd?: string }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const { spawn } = await import('node:child_process');

    return new Promise((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? 60000;
      const cwd = options?.cwd ?? process.cwd();

      const child = spawn('sh', ['-c', command], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
        } else {
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}

/**
 * Mock LLM reviewer for testing (real implementation would use LLM service)
 */
export class MockLLMReviewer implements ILLMReviewer {
  private responses: Map<string, { passed: boolean; reasoning: string }> = new Map();

  setResponse(prompt: string, response: { passed: boolean; reasoning: string }): void {
    this.responses.set(prompt, response);
  }

  async review(
    prompt: string,
    _context?: Record<string, unknown>
  ): Promise<{ passed: boolean; reasoning: string }> {
    const response = this.responses.get(prompt);
    if (response) {
      return response;
    }
    // Default to passing if no mock response set
    return {
      passed: true,
      reasoning: 'Mock review passed (no specific response configured)',
    };
  }
}

export class QualityGateRunner implements IQualityGateRunner {
  private config: QualityGateRunnerConfig;

  constructor(
    private commandExecutor: ICommandExecutor = new DefaultCommandExecutor(),
    private llmReviewer: ILLMReviewer = new MockLLMReviewer(),
    config?: Partial<QualityGateRunnerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run all quality gates for a work item
   */
  async runVerification(workItem: WorkItem, run: Run): Promise<VerificationResult> {
    const startTime = Date.now();
    const results: QualityGateResult[] = [];
    const gates = workItem.verification_plan?.quality_gates ?? [];

    if (gates.length === 0) {
      return {
        workItemId: workItem.id,
        runId: run.id,
        allPassed: true,
        requiredPassed: true,
        results: [],
        summary: 'No quality gates defined',
        totalDurationMs: Date.now() - startTime,
      };
    }

    let requiredFailed = false;

    for (const gate of gates) {
      // Skip remaining gates if a required gate failed and config says to stop
      if (requiredFailed && !this.config.continueOnRequiredFailure) {
        results.push({
          gateName: gate.name,
          gateType: gate.type,
          passed: false,
          required: gate.required,
          error: 'Skipped due to previous required gate failure',
          durationMs: 0,
        });
        continue;
      }

      const result = await this.runGate(gate);
      results.push(result);

      if (!result.passed && gate.required) {
        requiredFailed = true;
      }
    }

    const allPassed = results.every((r) => r.passed);
    const requiredPassed = results
      .filter((r) => r.required)
      .every((r) => r.passed);

    const passedCount = results.filter((r) => r.passed).length;
    const summary = `${passedCount}/${results.length} gates passed${
      requiredPassed ? '' : ' (required gates failed)'
    }`;

    return {
      workItemId: workItem.id,
      runId: run.id,
      allPassed,
      requiredPassed,
      results,
      summary,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Run a single quality gate
   */
  async runGate(gate: QualityGate): Promise<QualityGateResult> {
    const startTime = Date.now();

    try {
      if (gate.type === 'deterministic') {
        return await this.runDeterministicGate(gate, startTime);
      } else if (gate.type === 'llm_review') {
        return await this.runLLMReviewGate(gate, startTime);
      } else {
        return {
          gateName: gate.name,
          gateType: gate.type,
          passed: false,
          required: gate.required,
          error: `Unknown gate type: ${gate.type}`,
          durationMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      return {
        gateName: gate.name,
        gateType: gate.type,
        passed: false,
        required: gate.required,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get runner configuration
   */
  getConfig(): QualityGateRunnerConfig {
    return { ...this.config };
  }

  /**
   * Update runner configuration
   */
  updateConfig(config: Partial<QualityGateRunnerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Run a deterministic (command-based) quality gate
   */
  private async runDeterministicGate(
    gate: QualityGate,
    startTime: number
  ): Promise<QualityGateResult> {
    if (!gate.command) {
      return {
        gateName: gate.name,
        gateType: gate.type,
        passed: false,
        required: gate.required,
        error: 'No command specified for deterministic gate',
        durationMs: Date.now() - startTime,
      };
    }

    const result = await this.commandExecutor.execute(gate.command, {
      timeoutMs: this.config.commandTimeoutMs,
    });

    const expectedExitCode = gate.expected_exit_code ?? 0;
    const passed = result.exitCode === expectedExitCode;

    return {
      gateName: gate.name,
      gateType: gate.type,
      passed,
      required: gate.required,
      output: result.stdout || result.stderr || undefined,
      exitCode: result.exitCode,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Run an LLM review quality gate
   */
  private async runLLMReviewGate(
    gate: QualityGate,
    startTime: number
  ): Promise<QualityGateResult> {
    if (!gate.review_prompt) {
      return {
        gateName: gate.name,
        gateType: gate.type,
        passed: false,
        required: gate.required,
        error: 'No review prompt specified for LLM review gate',
        durationMs: Date.now() - startTime,
      };
    }

    const result = await this.llmReviewer.review(gate.review_prompt);

    return {
      gateName: gate.name,
      gateType: gate.type,
      passed: result.passed,
      required: gate.required,
      output: result.reasoning,
      durationMs: Date.now() - startTime,
    };
  }
}
