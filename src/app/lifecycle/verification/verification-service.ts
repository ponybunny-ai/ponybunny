import type { WorkItem, Run, QualityGate } from '../../../work-order/types/index.js';
import type { IVerificationService, VerificationResult, GateResult } from '../stage-interfaces.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class VerificationService implements IVerificationService {
  constructor() {}

  async verifyWorkItem(workItem: WorkItem, run: Run): Promise<VerificationResult> {
    if (!workItem.verification_plan) {
      return { passed: true, gateResults: [] };
    }

    const gateResults: GateResult[] = [];
    
    for (const gate of workItem.verification_plan.quality_gates) {
      if (!gate.required) continue;

      if (gate.type === 'deterministic') {
        const result = await this.runDeterministicGate(gate);
        gateResults.push(result);
        
        if (!result.passed) {
          return {
            passed: false,
            gateResults,
            failureReason: `Gate '${gate.name}' failed: ${result.output}`,
          };
        }
      }
    }

    return { passed: true, gateResults };
  }

  private async runDeterministicGate(gate: QualityGate): Promise<GateResult> {
    if (!gate.command) {
      return {
        name: gate.name,
        type: 'deterministic',
        passed: false,
        output: 'No command specified for deterministic gate',
      };
    }

    const startTime = Date.now();
    const expectedExitCode = gate.expected_exit_code ?? 0;

    try {
      const { stdout, stderr } = await execAsync(gate.command, {
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 10,
      });

      const executionTime = Date.now() - startTime;

      return {
        name: gate.name,
        type: 'deterministic',
        passed: true,
        output: stdout || stderr,
        executionTime,
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      const exitCode = error.code || 1;
      const passed = exitCode === expectedExitCode;

      return {
        name: gate.name,
        type: 'deterministic',
        passed,
        output: error.stdout || error.stderr || error.message,
        executionTime,
      };
    }
  }
}
