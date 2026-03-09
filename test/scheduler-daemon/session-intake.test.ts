import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConversationPort, ConversationRequest } from '../../src/runtime/conversation-boundary/index.js';
import { SchedulerSessionIntake, SchedulerTaskBridge, resolveMainAgentModelHintFromAgentConfig } from '../../src/scheduler-daemon/session-intake.js';
import { DEFAULT_RUNTIME_CONFIG } from '../../src/infra/config/runtime-config.js';
import type { Goal, WorkItem } from '../../src/work-order/types/index.js';

describe('resolveMainAgentModelHintFromAgentConfig', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-session-intake-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('reads model hint from user agent config', () => {
    const runtimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      agent: {
        ...DEFAULT_RUNTIME_CONFIG.agent,
        mainAgentId: 'lead',
      },
    };
    const userAgentsDir = path.join(tempRoot, 'user-agents');
    const workspaceDir = path.join(tempRoot, 'workspace');

    fs.mkdirSync(path.join(userAgentsDir, 'lead'), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'agents', 'lead'), { recursive: true });

    fs.writeFileSync(
      path.join(userAgentsDir, 'lead', 'agent.json'),
      JSON.stringify({ id: 'lead', runner: { config: { model_hint: 'openai.gpt-5.3' } } }, null, 2)
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'agents', 'lead', 'agent.json'),
      JSON.stringify({ id: 'lead', runner: { config: { model_hint: 'anthropic.claude-3-7-sonnet' } } }, null, 2)
    );

    const result = resolveMainAgentModelHintFromAgentConfig({
      runtimeConfig,
      userAgentsDir,
      workspaceDir,
    });

    expect(result).toBe('openai.gpt-5.3');
  });

  it('prioritizes runtime model override in ponybunny config', () => {
    const runtimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      agent: {
        ...DEFAULT_RUNTIME_CONFIG.agent,
        mainAgentId: 'lead',
        modelOverrides: {
          lead: 'openai.gpt-5.3',
        },
      },
    };

    const result = resolveMainAgentModelHintFromAgentConfig({
      runtimeConfig,
      userAgentsDir: path.join(tempRoot, 'user-agents'),
      workspaceDir: path.join(tempRoot, 'workspace'),
    });

    expect(result).toBe('openai.gpt-5.3');
  });

  it('falls back to workspace agent config when user config is missing', () => {
    const runtimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      agent: {
        ...DEFAULT_RUNTIME_CONFIG.agent,
        mainAgentId: 'lead',
      },
    };
    const userAgentsDir = path.join(tempRoot, 'user-agents');
    const workspaceDir = path.join(tempRoot, 'workspace');

    fs.mkdirSync(path.join(workspaceDir, 'agents', 'lead'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'agents', 'lead', 'agent.json'),
      JSON.stringify({ id: 'lead', runner: { config: { model_hint: 'openai.o4-mini' } } }, null, 2)
    );

    const result = resolveMainAgentModelHintFromAgentConfig({
      runtimeConfig,
      userAgentsDir,
      workspaceDir,
    });

    expect(result).toBe('openai.o4-mini');
  });

  it('returns undefined for missing or invalid model hint values', () => {
    const runtimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      agent: {
        ...DEFAULT_RUNTIME_CONFIG.agent,
        mainAgentId: 'lead',
      },
    };
    const userAgentsDir = path.join(tempRoot, 'user-agents');
    const workspaceDir = path.join(tempRoot, 'workspace');
    const agentDir = path.join(userAgentsDir, 'lead');

    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agent.json'), '{not-valid-json');

    const invalidJson = resolveMainAgentModelHintFromAgentConfig({
      runtimeConfig,
      userAgentsDir,
      workspaceDir,
    });
    expect(invalidJson).toBeUndefined();

    fs.writeFileSync(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({ id: 'lead', runner: { config: { model_hint: '   ' } } }, null, 2)
    );
    const blankHint = resolveMainAgentModelHintFromAgentConfig({
      runtimeConfig,
      userAgentsDir,
      workspaceDir,
    });
    expect(blankHint).toBeUndefined();
  });
});

describe('SchedulerTaskBridge', () => {
  it('propagates resolved model hint into conversation-created goal and work item context', async () => {
    const createdGoal: Goal = {
      id: 'goal-1',
      created_at: Date.now(),
      updated_at: Date.now(),
      title: 'test goal',
      description: 'test description',
      success_criteria: [],
      status: 'queued',
      priority: 5,
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
      context: undefined,
    };

    const repository = {
      createGoal: jest.fn((params: Partial<Goal>) => ({
        ...createdGoal,
        title: params.title ?? createdGoal.title,
        description: params.description ?? createdGoal.description,
        priority: params.priority ?? createdGoal.priority,
        success_criteria: params.success_criteria ?? createdGoal.success_criteria,
        context: params.context,
      })),
      createWorkItem: jest.fn((params: Partial<WorkItem>) => ({
        id: 'wi-1',
        created_at: Date.now(),
        updated_at: Date.now(),
        goal_id: params.goal_id ?? 'goal-1',
        title: params.title ?? 'wi',
        description: params.description ?? 'desc',
        item_type: params.item_type ?? 'analysis',
        status: 'queued',
        priority: params.priority ?? 5,
        dependencies: params.dependencies ?? [],
        blocks: [],
        estimated_effort: 'M',
        retry_count: 0,
        max_retries: 3,
        verification_status: 'not_started',
        context: params.context,
      })),
      getGoal: jest.fn(),
      getWorkItemsByGoal: jest.fn(() => []),
      listGoals: jest.fn(() => []),
      updateGoalStatus: jest.fn(),
      updateWorkItemStatus: jest.fn(),
      getWorkItem: jest.fn(),
      listWorkItems: jest.fn(() => []),
      listRuns: jest.fn(() => []),
      getRun: jest.fn(),
      getRunsByWorkItem: jest.fn(() => []),
      updateRunStatus: jest.fn(),
      createRun: jest.fn(),
      completeRun: jest.fn(),
      listArtifacts: jest.fn(() => []),
      createArtifact: jest.fn(),
      getEscalationsByGoal: jest.fn(() => []),
      createEscalation: jest.fn(),
      updateEscalationStatus: jest.fn(),
      initialize: jest.fn(),
      close: jest.fn(),
      reset: jest.fn(),
      migrate: jest.fn(),
      healthCheck: jest.fn(() => ({ healthy: true, details: [] })),
      getMetrics: jest.fn(() => ({
        totalGoals: 0,
        activeGoals: 0,
        completedGoals: 0,
        failedGoals: 0,
        totalRuns: 0,
        successRate: 1,
        averageCompletionTimeMs: 0,
      })),
    };

    const resolveModelHint = jest.fn((agentId?: string) => (
      agentId === 'planning' ? 'openai.gpt-5.3' : undefined
    ));

    const bridge = new SchedulerTaskBridge(
      repository as never,
      () => null,
      resolveModelHint
    );

    await bridge.createGoalFromConversation(
      {
        title: 'Build feature',
        description: 'do it',
        successCriteria: ['passes'],
        priority: 'medium',
      },
      { id: 'ses-1', personaId: 'pony-default' },
      'turn-1',
      { sourceAgentId: 'planning' }
    );

    expect(resolveModelHint).toHaveBeenCalledWith('planning');

    expect(repository.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        sessionId: 'ses-1',
        turnId: 'turn-1',
        selected_model: 'openai.gpt-5.3',
      }),
    }));
    expect(repository.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        sessionId: 'ses-1',
        turnId: 'turn-1',
        selected_model: 'openai.gpt-5.3',
        model: 'openai.gpt-5.3',
      }),
    }));
  });
});

describe('SchedulerSessionIntake conversation boundary', () => {
  function createRepositoryStub() {
    return {
      createGoal: jest.fn(),
      createWorkItem: jest.fn(),
      getGoal: jest.fn(),
      getWorkItemsByGoal: jest.fn(() => []),
      listGoals: jest.fn(() => []),
      updateGoalStatus: jest.fn(),
      updateWorkItemStatus: jest.fn(),
      getWorkItem: jest.fn(),
      listWorkItems: jest.fn(() => []),
      listRuns: jest.fn(() => []),
      getRun: jest.fn(),
      getRunsByWorkItem: jest.fn(() => []),
      updateRunStatus: jest.fn(),
      createRun: jest.fn(),
      completeRun: jest.fn(),
      listArtifacts: jest.fn(() => []),
      createArtifact: jest.fn(),
      getEscalationsByGoal: jest.fn(() => []),
      createEscalation: jest.fn(),
      updateEscalationStatus: jest.fn(),
      initialize: jest.fn(),
      close: jest.fn(),
      reset: jest.fn(),
      migrate: jest.fn(),
      healthCheck: jest.fn(() => ({ healthy: true, details: [] })),
      getMetrics: jest.fn(() => ({
        totalGoals: 0,
        activeGoals: 0,
        completedGoals: 0,
        failedGoals: 0,
        totalRuns: 0,
        successRate: 1,
        averageCompletionTimeMs: 0,
      })),
    };
  }

  function createLlmServiceStub() {
    return {
      generateResponse: jest.fn(),
      generateResponseWithTools: jest.fn(),
      getModelForTier: jest.fn(),
      complete: jest.fn(),
    };
  }

  it('routes processMessage through ConversationPort and preserves transport-facing behavior', async () => {
    const db = new Database(':memory:');
    const events: Array<{ event: string; gatewaySessionId?: string; sessionId?: string; payload?: Record<string, unknown> }> = [];
    const portRequests: ConversationRequest[] = [];
    const conversationPort: ConversationPort = {
      process: jest.fn(async (request) => {
        portRequests.push(request);
        return {
          conversationRequestId: request.conversationRequestId,
          sessionId: request.sessionId ?? 'ses-1',
          response: 'worker response',
          state: 'executing' as const,
          decision: 'goal_created' as const,
          decisionReason: 'Task bridge created executable goal from conversation intent.',
          taskInfo: {
            goalId: 'goal-1',
            status: 'started',
            progress: 0,
          },
        };
      }),
    };

    try {
      const intake = new SchedulerSessionIntake({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: createLlmServiceStub() as never,
        schedulerProvider: () => null,
        publishSessionEvent: async (event) => {
          events.push(event);
        },
        conversationPort,
        conversationRequestIdFactory: () => 'conv-req-1',
      });

      const result = await intake.processMessage({
        gatewaySessionId: 'gw-1',
        sessionId: 'ses-1',
        personaId: 'pony-default',
        userProfileId: 'user-1',
        agentId: 'planning',
        channelType: 'discord',
        channelSessionId: 'thread-7',
        message: 'build this',
        attachments: [
          {
            type: 'file',
            mimeType: 'text/plain',
            filename: 'spec.txt',
            url: 'file:///tmp/spec.txt',
          },
        ],
      });

      expect(conversationPort.process).toHaveBeenCalledTimes(1);
      expect(portRequests).toEqual([
        expect.objectContaining({
          conversationRequestId: 'conv-req-1',
          sessionId: 'ses-1',
          personaId: 'pony-default',
          userProfileId: 'user-1',
          agentId: 'planning',
          message: 'build this',
          attachments: [
            expect.objectContaining({
              type: 'file',
              filename: 'spec.txt',
            }),
          ],
        }),
      ]);

      expect(result).toEqual({
        sessionId: 'ses-1',
        response: 'worker response',
        state: 'executing',
        decision: 'goal_created',
        decisionReason: 'Task bridge created executable goal from conversation intent.',
        taskInfo: {
          goalId: 'goal-1',
          status: 'started',
          progress: 0,
        },
      });

      expect(events).toEqual([
        {
          event: 'conversation.message.started',
          gatewaySessionId: 'gw-1',
          sessionId: 'ses-1',
          payload: {
            stream: false,
            channelType: 'discord',
            channelSessionId: 'thread-7',
          },
        },
        {
          event: 'conversation.response',
          gatewaySessionId: 'gw-1',
          sessionId: 'ses-1',
          payload: {
            state: 'executing',
            decision: 'goal_created',
            decisionReason: 'Task bridge created executable goal from conversation intent.',
            hasTask: true,
            channelType: 'discord',
            channelSessionId: 'thread-7',
          },
        },
        {
          event: 'conversation.message.succeeded',
          gatewaySessionId: 'gw-1',
          sessionId: 'ses-1',
          payload: {
            state: 'executing',
            decision: 'goal_created',
            hasTask: true,
            stream: false,
            channelType: 'discord',
            channelSessionId: 'thread-7',
          },
        },
      ]);
    } finally {
      db.close();
    }
  });
});
