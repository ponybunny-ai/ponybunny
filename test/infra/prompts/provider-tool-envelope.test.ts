import { buildSystemPrompt } from '../../../src/infra/prompts/system-prompt-builder.js';
import type { SystemPromptContext } from '../../../src/infra/prompts/types.js';

describe('Provider-aware tool envelope prompt section', () => {
  it('includes route and policy audit details when provided', () => {
    const context: SystemPromptContext = {
      agentPhase: 'execution',
      workspaceDir: '/tmp/workspace',
      availableTools: [
        { name: 'read_file', description: 'Read files', category: 'core' },
        { name: 'write_file', description: 'Write files', category: 'core' },
      ],
      routeContext: {
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
        channel: 'telegram',
        agentId: 'assistant',
        senderIsOwner: false,
        sandboxed: true,
        isSubagent: false,
      },
      toolPolicyAudit: {
        hasLayeredPolicy: true,
        baselineAllowedTools: ['read_file', 'write_file', 'execute_command'],
        effectiveAllowedTools: ['read_file', 'write_file'],
        deniedTools: [{ tool: 'execute_command', reason: 'provider:openai/gpt-5.3-codex deny policy' }],
        appliedLayers: ['global', 'provider:openai/gpt-5.3-codex'],
      },
    };

    const result = buildSystemPrompt(context);

    expect(result.prompt).toContain('## Provider-Aware Tool Envelope');
    expect(result.prompt).toContain('route.provider=openai/gpt-5.3-codex');
    expect(result.prompt).toContain('policy.layers=global -> provider:openai/gpt-5.3-codex');
    expect(result.prompt).toContain('execute_command: provider:openai/gpt-5.3-codex deny policy');
  });
});
