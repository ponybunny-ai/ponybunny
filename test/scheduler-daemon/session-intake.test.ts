import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConversationPort, ConversationRequest } from '../../src/runtime/conversation-boundary/index.js';
import type { RuntimeToolingContext } from '../../src/runtime/tooling-context/index.js';
import { ConversationWorker } from '../../src/runtime/workers/conversation-worker.js';
import { SchedulerSessionIntake, SchedulerTaskBridge, resolveMainAgentModelHintFromAgentConfig } from '../../src/scheduler-daemon/session-intake.js';
import { DEFAULT_RUNTIME_CONFIG } from '../../src/infra/config/runtime-config.js';
import type { Goal } from '../../src/work-order/types/index.js';

function createRuntimeToolingContextStub(): RuntimeToolingContext {
  return {
    toolProvider: {
      getToolDefinitions: () => [],
      getToolsForPhase: () => [],
    },
    getPromptProvider: () => ({
      generatePrompt: () => '',
    }),
  } as unknown as RuntimeToolingContext;
}

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
  it('delegates conversation goal materialization to the injected owner', async () => {
    const repository = {
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
    const materializer = {
      materializeGoalFromConversation: jest.fn(async () => ({
        goalId: 'goal-1',
        workItems: [{ id: 'wi-1', title: 'Build feature', status: 'queued' }],
      })),
    };

    const bridge = new SchedulerTaskBridge(
      repository as never,
      materializer
    );

    const result = await bridge.createGoalFromConversation(
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

    expect(materializer.materializeGoalFromConversation).toHaveBeenCalledWith(
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
    expect(result).toEqual({
      goalId: 'goal-1',
      workItems: [{ id: 'wi-1', title: 'Build feature', status: 'queued' }],
    });
  });

  it('retains repository-backed status observation behavior', async () => {
    const createdAt = Date.now();
    const repository = {
      getGoal: jest.fn(() => ({
        id: 'goal-1',
        created_at: createdAt,
        status: 'active',
      } as Goal)),
      getWorkItemsByGoal: jest.fn(() => ([
        { id: 'wi-1', title: 'First', status: 'done' },
        { id: 'wi-2', title: 'Second', status: 'in_progress' },
      ])),
      updateGoalStatus: jest.fn(),
    };
    const bridge = new SchedulerTaskBridge(
      repository as never,
      {
        materializeGoalFromConversation: jest.fn(),
      }
    );

    await expect(bridge.getTaskStatus('goal-1')).resolves.toEqual({
      goalId: 'goal-1',
      goalStatus: 'active',
      completedItems: 1,
      totalItems: 2,
      currentItem: {
        id: 'wi-2',
        title: 'Second',
        status: 'in_progress',
      },
      startedAt: createdAt,
    });
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
    const repository = createRepositoryStub();
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
        repository: repository as never,
        memoryDb: db,
        llmService: createLlmServiceStub() as never,
        runtimeToolingContext: createRuntimeToolingContextStub(),
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

      expect(repository.createGoal).not.toHaveBeenCalled();
      expect(repository.createWorkItem).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('rejects mismatched ConversationResult identity before success events are published', async () => {
    const db = new Database(':memory:');
    const events: Array<{ event: string; gatewaySessionId?: string; sessionId?: string; payload?: Record<string, unknown> }> = [];
    const conversationPort: ConversationPort = {
      process: jest.fn(async () => ({
        conversationRequestId: 'conv-req-other',
        sessionId: 'ses-1',
        response: 'worker response',
        state: 'chatting' as const,
      })),
    };

    try {
      const intake = new SchedulerSessionIntake({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: createLlmServiceStub() as never,
        runtimeToolingContext: createRuntimeToolingContextStub(),
        schedulerProvider: () => null,
        publishSessionEvent: async (event) => {
          events.push(event);
        },
        conversationPort,
        conversationRequestIdFactory: () => 'conv-req-1',
      });

      await expect(intake.processMessage({
        gatewaySessionId: 'gw-1',
        sessionId: 'ses-1',
        message: 'build this',
      })).rejects.toThrow(
        "Invalid ConversationResult for request 'conv-req-1': conversationRequestId expected conv-req-1, received conv-req-other"
      );

      expect(events).toEqual([
        {
          event: 'conversation.message.started',
          gatewaySessionId: 'gw-1',
          sessionId: 'ses-1',
          payload: {
            stream: false,
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('exposes local conversation worker inspection through SchedulerSessionIntake', async () => {
    const db = new Database(':memory:');

    try {
      const conversationPort = new ConversationWorker({
        processMessage: jest.fn(async () => ({
          sessionId: 'ses-1',
          response: 'worker response',
          state: 'chatting' as const,
        })),
      });

      const intake = new SchedulerSessionIntake({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: createLlmServiceStub() as never,
        runtimeToolingContext: createRuntimeToolingContextStub(),
        schedulerProvider: () => null,
        publishSessionEvent: async () => {},
        conversationPort,
        conversationRequestIdFactory: () => 'conv-req-1',
      });

      await intake.processMessage({
        gatewaySessionId: 'gw-1',
        sessionId: 'ses-1',
        message: 'build this',
      });

      expect(intake.inspectConversationWorker()).toEqual({
        summary: {
          totalRequests: 1,
          inFlightCount: 0,
          recentCount: 1,
          successCount: 1,
          failureCount: 0,
          invalidCount: 0,
          timedOutCount: 0,
          lateCompletionObservedCount: 0,
          ignoredLateCompletionCount: 0,
          duplicateSuppressedCount: 0,
        },
        inFlight: [],
        recent: [
          expect.objectContaining({
            conversationRequestId: 'conv-req-1',
            requestedSessionId: 'ses-1',
            resultSessionId: 'ses-1',
            outcome: 'success',
            resultMatchedRequestId: true,
            sessionIdMatched: true,
            timedOut: false,
            lateCompletionObserved: false,
            lateCompletionCount: 0,
          }),
        ],
      });
    } finally {
      db.close();
    }
  });

  it('preserves one failure path when ConversationWorker times out locally', async () => {
    jest.useFakeTimers();
    const db = new Database(':memory:');
    const events: Array<{ event: string; gatewaySessionId?: string; sessionId?: string; payload?: Record<string, unknown> }> = [];

    try {
      const conversationPort = new ConversationWorker({
        processMessage: jest.fn().mockReturnValue(new Promise(() => undefined)),
      }, undefined, { timeoutMs: 25 });

      const intake = new SchedulerSessionIntake({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: createLlmServiceStub() as never,
        runtimeToolingContext: createRuntimeToolingContextStub(),
        schedulerProvider: () => null,
        publishSessionEvent: async (event) => {
          events.push(event);
        },
        conversationPort,
        conversationRequestIdFactory: () => 'conv-req-timeout',
      });

      const resultPromise = intake.processMessage({
        gatewaySessionId: 'gw-1',
        sessionId: 'ses-1',
        personaId: 'pony-default',
        userProfileId: 'user-1',
        agentId: 'planning',
        message: 'build this',
      });
      const timeoutExpectation = expect(resultPromise).rejects.toMatchObject({
        name: 'ConversationWorkerTimeoutError',
        code: 'CONVERSATION_EXECUTION_TIMEOUT',
        conversationRequestId: 'conv-req-timeout',
        sessionId: 'ses-1',
        personaId: 'pony-default',
        userProfileId: 'user-1',
        agentId: 'planning',
      });

      await jest.advanceTimersByTimeAsync(25);

      await timeoutExpectation;

      expect(events).toEqual([
        {
          event: 'conversation.message.started',
          gatewaySessionId: 'gw-1',
          sessionId: 'ses-1',
          payload: {
            stream: false,
          },
        },
      ]);
      expect(intake.inspectConversationWorker()).toEqual({
        summary: {
          totalRequests: 1,
          inFlightCount: 0,
          recentCount: 1,
          successCount: 0,
          failureCount: 1,
          invalidCount: 0,
          timedOutCount: 1,
          lateCompletionObservedCount: 0,
          ignoredLateCompletionCount: 0,
          duplicateSuppressedCount: 0,
        },
        inFlight: [],
        recent: [
          expect.objectContaining({
            conversationRequestId: 'conv-req-timeout',
            requestedSessionId: 'ses-1',
            outcome: 'failure',
            timedOut: true,
            lateCompletionObserved: false,
            lateCompletionCount: 0,
            failureCode: 'CONVERSATION_EXECUTION_TIMEOUT',
          }),
        ],
      });
    } finally {
      jest.useRealTimers();
      db.close();
    }
  });
});
