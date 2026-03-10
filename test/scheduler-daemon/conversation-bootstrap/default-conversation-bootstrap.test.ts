import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ConversationPort } from '../../../src/runtime/conversation-boundary/index.js';
import type { RuntimeToolingContext } from '../../../src/runtime/tooling-context/index.js';
import { ConversationWorker } from '../../../src/runtime/workers/conversation-worker.js';
import { createDefaultConversationBootstrap } from '../../../src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.js';

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

function createRuntimeToolingContextStub(tools: Array<{ name: string }>): RuntimeToolingContext {
  return {
    toolProvider: {
      getToolDefinitions: () => tools.map((tool) => ({
        name: tool.name,
        description: `${tool.name} description`,
        parameters: { type: 'object', properties: {} },
      })),
      getToolsForPhase: () => [],
    },
  } as unknown as RuntimeToolingContext;
}

describe('createDefaultConversationBootstrap', () => {
  it('creates the default local ConversationWorker when no port override is supplied', () => {
    const db = new Database(':memory:');

    try {
      const bootstrap = createDefaultConversationBootstrap({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: { completeForWorkload: jest.fn() } as never,
        runtimeToolingContext: createRuntimeToolingContextStub([]),
        schedulerProvider: () => null,
      });

      expect(bootstrap.conversationPort).toBeInstanceOf(ConversationWorker);
    } finally {
      db.close();
    }
  });

  it('preserves an injected ConversationPort override', () => {
    const db = new Database(':memory:');
    const conversationPort: ConversationPort = {
      process: jest.fn(),
    };

    try {
      const bootstrap = createDefaultConversationBootstrap({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: { completeForWorkload: jest.fn() } as never,
        runtimeToolingContext: createRuntimeToolingContextStub([]),
        schedulerProvider: () => null,
        conversationPort,
      });

      expect(bootstrap.conversationPort).toBe(conversationPort);
    } finally {
      db.close();
    }
  });

  it('keeps RuntimeToolingContext as the migrated conversation-tooling source on the default path', async () => {
    const db = new Database(':memory:');
    const personasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-conversation-bootstrap-'));
    const llmService = {
      completeForWorkload: jest.fn(async (_workload, messages, options) => {
        const systemPrompt = messages[0]?.content ?? '';

        if (systemPrompt.includes('expert at analyzing user input')) {
          return {
            content: JSON.stringify({
              intent: {
                primary: 'question',
                confidence: 0.9,
                entities: [],
              },
              emotion: {
                primary: 'neutral',
                intensity: 0.1,
                urgency: 'low',
              },
              purpose: {
                isActionable: false,
                missingInfo: [],
              },
            }),
          };
        }

        if (systemPrompt.includes('You summarize conversation turns into durable core memory')) {
          return {
            content: JSON.stringify({
              summary: 'Stored summary',
              importance: 0.6,
            }),
          };
        }

        return {
          content: 'response from bootstrap',
          toolCalls: [],
        };
      }),
    };

    try {
      fs.writeFileSync(
        path.join(personasDir, 'pony-default.json'),
        JSON.stringify({
          id: 'pony-default',
          name: 'Pony',
          nickname: '小马',
          personality: { warmth: 0.8, formality: 0.4, humor: 0.5, empathy: 0.7 },
          communicationStyle: {
            verbosity: 'balanced',
            technicalDepth: 'adaptive',
            expressiveness: 'moderate',
          },
          expertise: {
            primaryDomains: ['software-engineering'],
            skillConfidence: { coding: 0.95 },
          },
          backstory: '我是 Pony，你的自主 AI 助手。',
          locale: 'zh-CN',
        }),
        'utf-8'
      );

      const bootstrap = createDefaultConversationBootstrap({
        repository: createRepositoryStub() as never,
        memoryDb: db,
        llmService: llmService as never,
        runtimeToolingContext: createRuntimeToolingContextStub([{ name: 'web_search' }]),
        schedulerProvider: () => null,
        personasDir,
      });

      const result = await bootstrap.conversationPort.process({
        conversationRequestId: 'conv-req-1',
        message: 'search for docs',
      });

      expect(result).toEqual(expect.objectContaining({
        conversationRequestId: 'conv-req-1',
        response: 'response from bootstrap',
      }));

      expect(llmService.completeForWorkload).toHaveBeenCalledWith(
        'conversation',
        expect.any(Array),
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              name: 'web_search',
            }),
          ],
        })
      );
    } finally {
      fs.rmSync(personasDir, { recursive: true, force: true });
      db.close();
    }
  });
});
