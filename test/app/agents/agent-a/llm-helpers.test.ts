import { AgentALLMHelper } from '../../../../src/app/agents/agent-a/llm-helpers.js';
import type { LLMMessage, LLMResponse } from '../../../../src/infra/llm/llm-provider.js';
import { LLMService } from '../../../../src/infra/llm/llm-service.js';
import { DEFAULT_AGENT_A_CONFIG } from '../../../../src/app/agents/agent-a/limits.js';

class FakeLLMService extends LLMService {
  private responses: LLMResponse[];

  constructor(responses: LLMResponse[]) {
    super({ useUnifiedProvider: false });
    this.responses = responses;
  }

  override async completeForAgent(_agentId: string, _messages: LLMMessage[]): Promise<LLMResponse> {
    const next = this.responses.shift();
    if (!next) {
      return { content: '', tokensUsed: 0, model: 'test', finishReason: 'stop' } as LLMResponse;
    }
    return next;
  }
}

describe('AgentALLMHelper', () => {
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
