import type { WorkItem, Run, QualityGate } from '../../../work-order/types/index.js';
import type { IVerificationService, VerificationResult, GateResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

const execAsync = promisify(exec);

export class VerificationService implements IVerificationService {
  constructor(private llmProvider?: ILLMProvider) {}

  async verifyWorkItem(workItem: WorkItem, run: Run): Promise<VerificationResult> {
    if (!workItem.verification_plan) {
      return { passed: true, gateResults: [] };
    }

    const gateResults: GateResult[] = [];
    
    for (const gate of workItem.verification_plan.quality_gates) {
      if (!gate.required) continue;

      let result: GateResult;

      if (gate.type === 'deterministic') {
        result = await this.runDeterministicGate(gate);
      } else if (gate.type === 'llm_review') {
        result = await this.runLLMReviewGate(gate, run);
      } else {
        result = {
          name: gate.name,
          type: gate.type,
          passed: false,
          output: `Unknown gate type: ${gate.type}`,
        };
      }

      gateResults.push(result);
      
      if (!result.passed) {
        return {
          passed: false,
          gateResults,
          failureReason: `Gate '${gate.name}' failed: ${result.output}`,
        };
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

  private async runLLMReviewGate(gate: QualityGate, run: Run): Promise<GateResult> {
    if (!this.llmProvider) {
      return {
        name: gate.name,
        type: 'llm_review',
        passed: false,
        output: 'No LLM provider configured for review gate',
      };
    }

    const startTime = Date.now();
    
    const executionLog = run.execution_log || 'No execution log available.';
    
    const systemPrompt = `You are a Senior Code Reviewer and QA Specialist.
Your job is to verify if a task was completed successfully based on the execution log and requirements.

Task Requirements:
${gate.review_prompt || 'Verify the task was completed correctly.'}

Review Guidelines:
1. Analyze the Execution Log carefully.
2. Check if the actions taken match the requirements.
3. Look for errors, warnings, or incomplete steps.
4. If the log shows the task failed or is incomplete, fail the review.
5. Be strict but fair.

Output Format:
Return a JSON object:
{
  "passed": boolean,
  "reasoning": "Detailed explanation of why it passed or failed"
}`;

    const userPrompt = `Task Title: ${run.goal_id} (Work Item: ${run.work_item_id})
    
Execution Log:
${executionLog.substring(0, 10000)} // Truncate to avoid context limit

Did this execution satisfy the requirement: "${gate.name}"?`;

    try {
      const response = await this.llmProvider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: 0.0,
        model: 'gpt-4o',
      });

      const content = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(content);

      return {
        name: gate.name,
        type: 'llm_review',
        passed: result.passed,
        output: result.reasoning,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name: gate.name,
        type: 'llm_review',
        passed: false,
        output: `Review failed: ${(error as Error).message}`,
        executionTime: Date.now() - startTime,
      };
    }
  }
}
