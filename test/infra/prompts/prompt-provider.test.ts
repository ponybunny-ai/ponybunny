import { jest } from '@jest/globals';

const buildSystemPromptMock = jest.fn(() => ({
  prompt: 'mock prompt',
  sections: [],
  metadata: {
    phase: 'execution',
    mode: 'full',
    toolCount: 0,
    skillCount: 0,
    sectionCount: 0,
  },
}));

jest.mock('../../../src/infra/prompts/system-prompt-builder.js', () => ({
  buildSystemPrompt: buildSystemPromptMock,
}));

jest.mock('../../../src/infra/skills/skill-registry.js', () => ({
  getGlobalSkillRegistry: () => ({
    getSkillsForPhase: () => [],
    generateSkillsPrompt: () => '',
  }),
}));

jest.mock('../../../src/infra/tools/tool-provider.js', () => ({
  getGlobalToolProvider: () => ({
    getToolsForPhase: () => [
      { name: 'read_file', description: 'Read files', category: 'core' },
      { name: 'write_file', description: 'Write files', category: 'core' },
    ],
  }),
}));

import type { WorkItem } from '../../../src/work-order/types/index.js';
import { PromptProvider } from '../../../src/infra/prompts/prompt-provider.js';

const createWorkItem = (context: Record<string, unknown>): WorkItem => ({
  id: 'wi-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  goal_id: 'goal-1',
  title: 'test',
  description: 'test',
  item_type: 'analysis',
  status: 'ready',
  priority: 50,
  dependencies: [],
  blocks: [],
  estimated_effort: 'S',
  retry_count: 0,
  max_retries: 1,
  verification_status: 'not_started',
  context,
});

describe('PromptProvider', () => {
  beforeEach(() => {
    buildSystemPromptMock.mockClear();
  });

  it('injects route_context and tool_policy_audit into prompt context', () => {
    const provider = new PromptProvider();
    const workItem = createWorkItem({
      route_context: {
        source: 'gateway.message',
        provider_id: 'openai/gpt-5.3-codex',
        channel: 'telegram',
        sender_is_owner: false,
      },
      tool_policy_audit: {
        hasLayeredPolicy: true,
        baselineAllowedTools: ['read_file', 'write_file', 'execute_command'],
        effectiveAllowedTools: ['read_file', 'write_file'],
        deniedTools: [{ tool: 'execute_command', reason: 'provider deny' }],
        appliedLayers: ['global', 'provider:openai/gpt-5.3-codex'],
      },
    });

    provider.generateExecutionPrompt({
      workspaceDir: '/tmp/workspace',
      workItem,
    });

    expect(buildSystemPromptMock).toHaveBeenCalledTimes(1);
    const calls = (buildSystemPromptMock as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const context = calls[0][0] as Record<string, unknown>;
    expect(context.routeContext).toEqual(
      expect.objectContaining({
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
        channel: 'telegram',
        senderIsOwner: false,
      })
    );
    expect(context.toolPolicyAudit).toEqual(
      expect.objectContaining({
        hasLayeredPolicy: true,
        effectiveAllowedTools: ['read_file', 'write_file'],
      })
    );
    expect(context.toolPolicy).toEqual({
      allow: ['read_file', 'write_file'],
      deny: ['execute_command'],
    });
  });

  it('handles malformed tool_policy_audit without throwing', () => {
    const provider = new PromptProvider();
    const workItem = createWorkItem({
      routeContext: {
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
      },
      tool_policy_audit: {
        hasLayeredPolicy: 'wrong-type',
        baselineAllowedTools: ['read_file', 1],
        deniedTools: ['bad-format'],
      },
    });

    expect(() =>
      provider.generateExecutionPrompt({
        workspaceDir: '/tmp/workspace',
        workItem,
      })
    ).not.toThrow();

    const calls = (buildSystemPromptMock as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const context = calls[0][0] as Record<string, unknown>;
    expect(context.toolPolicyAudit).toEqual(
      expect.objectContaining({
        hasLayeredPolicy: false,
        baselineAllowedTools: ['read_file'],
        deniedTools: [],
      })
    );
  });
});
