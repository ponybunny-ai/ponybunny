import {
  QualityGateRunner,
  MockLLMReviewer,
} from '../../../src/scheduler/quality-gate-runner/quality-gate-runner.js';
import type {
  ICommandExecutor,
} from '../../../src/scheduler/quality-gate-runner/types.js';
import type { QualityGate, WorkItem, Run } from '../../../src/work-order/types/index.js';

describe('QualityGateRunner', () => {
  let runner: QualityGateRunner;
  let mockExecutor: jest.Mocked<ICommandExecutor>;
  let mockReviewer: MockLLMReviewer;

  const createWorkItem = (gates: QualityGate[] = []): WorkItem => ({
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'Test description',
    item_type: 'code',
    status: 'verify',
    priority: 50,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    verification_plan: gates.length > 0 ? { quality_gates: gates, acceptance_criteria: [] } : undefined,
  });

  const createRun = (): Run => ({
    id: 'run-1',
    created_at: Date.now(),
    work_item_id: 'wi-1',
    goal_id: 'goal-1',
    agent_type: 'test-agent',
    run_sequence: 1,
    status: 'running',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
  });

  const createDeterministicGate = (overrides: Partial<QualityGate> = {}): QualityGate => ({
    name: 'Test Gate',
    type: 'deterministic',
    command: 'echo "test"',
    expected_exit_code: 0,
    required: true,
    ...overrides,
  });

  const createLLMGate = (overrides: Partial<QualityGate> = {}): QualityGate => ({
    name: 'LLM Review Gate',
    type: 'llm_review',
    review_prompt: 'Review the code quality',
    required: true,
    ...overrides,
  });

  beforeEach(() => {
    mockExecutor = {
      execute: jest.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'success',
        stderr: '',
      }),
    };

    mockReviewer = new MockLLMReviewer();

    runner = new QualityGateRunner(mockExecutor, mockReviewer);
  });

  describe('runGate', () => {
    describe('deterministic gates', () => {
      it('should pass when exit code matches expected', async () => {
        const gate = createDeterministicGate({ expected_exit_code: 0 });
        mockExecutor.execute.mockResolvedValue({
          exitCode: 0,
          stdout: 'All tests passed',
          stderr: '',
        });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe('All tests passed');
      });

      it('should fail when exit code does not match', async () => {
        const gate = createDeterministicGate({ expected_exit_code: 0 });
        mockExecutor.execute.mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'Test failed',
        });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(false);
        expect(result.exitCode).toBe(1);
      });

      it('should use custom expected exit code', async () => {
        const gate = createDeterministicGate({ expected_exit_code: 2 });
        mockExecutor.execute.mockResolvedValue({
          exitCode: 2,
          stdout: '',
          stderr: '',
        });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(true);
      });

      it('should fail when no command specified', async () => {
        const gate = createDeterministicGate({ command: undefined });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(false);
        expect(result.error).toContain('No command specified');
      });

      it('should handle command execution errors', async () => {
        const gate = createDeterministicGate();
        mockExecutor.execute.mockRejectedValue(new Error('Command timed out'));

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(false);
        expect(result.error).toBe('Command timed out');
      });

      it('should track duration', async () => {
        const gate = createDeterministicGate();

        const result = await runner.runGate(gate);

        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('LLM review gates', () => {
      it('should pass when LLM review passes', async () => {
        const gate = createLLMGate();
        mockReviewer.setResponse('Review the code quality', {
          passed: true,
          reasoning: 'Code looks good',
        });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(true);
        expect(result.output).toBe('Code looks good');
      });

      it('should fail when LLM review fails', async () => {
        const gate = createLLMGate();
        mockReviewer.setResponse('Review the code quality', {
          passed: false,
          reasoning: 'Code has issues',
        });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(false);
        expect(result.output).toBe('Code has issues');
      });

      it('should fail when no review prompt specified', async () => {
        const gate = createLLMGate({ review_prompt: undefined });

        const result = await runner.runGate(gate);

        expect(result.passed).toBe(false);
        expect(result.error).toContain('No review prompt specified');
      });
    });
  });

  describe('runVerification', () => {
    it('should return success when no gates defined', async () => {
      const workItem = createWorkItem([]);
      const run = createRun();

      const result = await runner.runVerification(workItem, run);

      expect(result.allPassed).toBe(true);
      expect(result.requiredPassed).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.summary).toBe('No quality gates defined');
    });

    it('should run all gates and aggregate results', async () => {
      const gates = [
        createDeterministicGate({ name: 'Gate 1' }),
        createDeterministicGate({ name: 'Gate 2' }),
      ];
      const workItem = createWorkItem(gates);
      const run = createRun();

      const result = await runner.runVerification(workItem, run);

      expect(result.results).toHaveLength(2);
      expect(result.allPassed).toBe(true);
      expect(result.requiredPassed).toBe(true);
    });

    it('should report when required gates fail', async () => {
      const gates = [
        createDeterministicGate({ name: 'Required Gate', required: true }),
        createDeterministicGate({ name: 'Optional Gate', required: false }),
      ];
      const workItem = createWorkItem(gates);
      const run = createRun();

      mockExecutor.execute
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'failed' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' });

      // With continueOnRequiredFailure = false (default), second gate is skipped
      const result = await runner.runVerification(workItem, run);

      expect(result.allPassed).toBe(false);
      expect(result.requiredPassed).toBe(false);
      expect(result.summary).toContain('required gates failed');
    });

    it('should continue after required failure when configured', async () => {
      runner.updateConfig({ continueOnRequiredFailure: true });

      const gates = [
        createDeterministicGate({ name: 'Required Gate', required: true }),
        createDeterministicGate({ name: 'Optional Gate', required: false }),
      ];
      const workItem = createWorkItem(gates);
      const run = createRun();

      mockExecutor.execute
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'failed' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' });

      const result = await runner.runVerification(workItem, run);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].passed).toBe(false);
      expect(result.results[1].passed).toBe(true);
    });

    it('should skip remaining gates after required failure by default', async () => {
      const gates = [
        createDeterministicGate({ name: 'Required Gate', required: true }),
        createDeterministicGate({ name: 'Second Gate', required: true }),
      ];
      const workItem = createWorkItem(gates);
      const run = createRun();

      mockExecutor.execute.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'failed',
      });

      const result = await runner.runVerification(workItem, run);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].passed).toBe(false);
      expect(result.results[1].error).toContain('Skipped');
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    });

    it('should track total duration', async () => {
      const gates = [createDeterministicGate()];
      const workItem = createWorkItem(gates);
      const run = createRun();

      const result = await runner.runVerification(workItem, run);

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include workItemId and runId in result', async () => {
      const workItem = createWorkItem([createDeterministicGate()]);
      const run = createRun();

      const result = await runner.runVerification(workItem, run);

      expect(result.workItemId).toBe('wi-1');
      expect(result.runId).toBe('run-1');
    });

    it('should handle mixed gate types', async () => {
      const gates = [
        createDeterministicGate({ name: 'Command Gate' }),
        createLLMGate({ name: 'Review Gate' }),
      ];
      const workItem = createWorkItem(gates);
      const run = createRun();

      mockReviewer.setResponse('Review the code quality', {
        passed: true,
        reasoning: 'Looks good',
      });

      const result = await runner.runVerification(workItem, run);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].gateType).toBe('deterministic');
      expect(result.results[1].gateType).toBe('llm_review');
      expect(result.allPassed).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should return current config', () => {
      const config = runner.getConfig();

      expect(config.commandTimeoutMs).toBe(60000);
      expect(config.llmTimeoutMs).toBe(120000);
      expect(config.continueOnRequiredFailure).toBe(false);
      expect(config.maxConcurrency).toBe(3);
    });

    it('should allow custom config on construction', () => {
      const customRunner = new QualityGateRunner(mockExecutor, mockReviewer, {
        commandTimeoutMs: 30000,
        continueOnRequiredFailure: true,
      });

      const config = customRunner.getConfig();

      expect(config.commandTimeoutMs).toBe(30000);
      expect(config.continueOnRequiredFailure).toBe(true);
    });

    it('should update config', () => {
      runner.updateConfig({ maxConcurrency: 5 });

      expect(runner.getConfig().maxConcurrency).toBe(5);
    });

    it('should pass timeout to command executor', async () => {
      runner.updateConfig({ commandTimeoutMs: 5000 });
      const gate = createDeterministicGate();

      await runner.runGate(gate);

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        gate.command,
        expect.objectContaining({ timeoutMs: 5000 })
      );
    });
  });

  describe('MockLLMReviewer', () => {
    it('should return configured response', async () => {
      mockReviewer.setResponse('test prompt', {
        passed: false,
        reasoning: 'Custom reason',
      });

      const result = await mockReviewer.review('test prompt');

      expect(result.passed).toBe(false);
      expect(result.reasoning).toBe('Custom reason');
    });

    it('should return default pass for unconfigured prompts', async () => {
      const result = await mockReviewer.review('unknown prompt');

      expect(result.passed).toBe(true);
      expect(result.reasoning).toContain('Mock review passed');
    });
  });
});
