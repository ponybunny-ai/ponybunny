import { AgentALLMHelper } from '../../../../src/app/agents/agent-a/llm-helpers.js';
import type { LLMMessage, LLMResponse } from '../../../../src/infra/llm/llm-provider.js';
import { LLMService } from '../../../../src/infra/llm/llm-service.js';
import { DEFAULT_AGENT_A_CONFIG } from '../../../../src/app/agents/agent-a/limits.js';

class FakeLLMService extends LLMService {
  private responses: LLMResponse[];
  public lastMessages: LLMMessage[] = [];

  constructor(responses: LLMResponse[]) {
    super({ useUnifiedProvider: false });
    this.responses = responses;
  }

  override async completeForAgent(_agentId: string, messages: LLMMessage[]): Promise<LLMResponse> {
    this.lastMessages = messages;
    const next = this.responses.shift();
    if (!next) {
      return { content: '', tokensUsed: 0, model: 'test', finishReason: 'stop' } as LLMResponse;
    }
    return next;
  }
}

describe('AgentALLMHelper', () => {
  test('prompts include guardrails and JSON constraints', async () => {
    const llm = new FakeLLMService([
      { content: JSON.stringify({ has_problem_signal: false, signal_markers: [], label: 'other', confidence: 0.1 }), tokensUsed: 1, model: 'test', finishReason: 'stop' },
      { content: JSON.stringify({ problem_raw_text: 'raw', surrounding_context: '', mentioned_tools: [], constraints: [] }), tokensUsed: 1, model: 'test', finishReason: 'stop' },
      { content: JSON.stringify({ role_guess: 'unknown', confidence: 0.1 }), tokensUsed: 1, model: 'test', finishReason: 'stop' },
    ]);
    const helper = new AgentALLMHelper(llm, DEFAULT_AGENT_A_CONFIG.limits);

    await helper.detectProblemSignal({ raw_text: 'help', platform: 'reddit' });
    const detectSystem = llm.lastMessages.find(m => m.role === 'system')?.content || '';
    expect(detectSystem).toContain('Return ONLY valid JSON');
    expect(detectSystem).toContain('Never provide advice');

    await helper.extractProblemBlock({ raw_text: 'help', window_chars: 200, platform: 'reddit' });
    const extractSystem = llm.lastMessages.find(m => m.role === 'system')?.content || '';
    const extractUser = llm.lastMessages.find(m => m.role === 'user')?.content || '';
    expect(extractSystem).toContain('Return ONLY valid JSON');
    expect(extractSystem).toContain('Never post');
    expect(extractUser).toContain('Verbatim only');

    await helper.guessAuthorRole('help');
    const roleSystem = llm.lastMessages.find(m => m.role === 'system')?.content || '';
    expect(roleSystem).toContain('Return ONLY valid JSON');
    expect(roleSystem).toContain('Never post');
  });

  test('detectProblemSignal falls back on invalid JSON', async () => {
    const llm = new FakeLLMService([
      { content: 'not-json', tokensUsed: 1, model: 'test', finishReason: 'stop' },
    ]);
    const helper = new AgentALLMHelper(llm, DEFAULT_AGENT_A_CONFIG.limits);

    const result = await helper.detectProblemSignal({ raw_text: 'I need help', platform: 'reddit' });
    expect(result.confidence).toBe(0);
    expect(result.has_problem_signal).toBe(true);
  });

  test('guessAuthorRole clamps confidence to 0.5', async () => {
    const llm = new FakeLLMService([
      {
        content: JSON.stringify({ role_guess: 'developer', confidence: 0.9 }),
        tokensUsed: 1,
        model: 'test',
        finishReason: 'stop',
      },
    ]);
    const helper = new AgentALLMHelper(llm, DEFAULT_AGENT_A_CONFIG.limits);

    const result = await helper.guessAuthorRole('I write code');
    expect(result.role_guess).toBe('developer');
    expect(result.confidence).toBe(0.5);
  });
});
