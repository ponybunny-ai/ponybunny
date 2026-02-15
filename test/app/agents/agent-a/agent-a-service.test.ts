import { AgentAService } from '../../../../src/app/agents/agent-a/agent-a-service.js';
import type { AgentARawItem, AgentASourceConfig, AgentACheckpoint } from '../../../../src/app/agents/agent-a/types.js';

class FakeStorage {
  public calls: string[] = [];
  public checkpoints: AgentACheckpoint | null = null;

  async ensureSchema(): Promise<void> {
    this.calls.push('ensureSchema');
  }

  async recordRunStart(_runId: string): Promise<void> {
    this.calls.push('recordRunStart');
  }

  async recordRunFinish(
    _runId: string,
    _metrics: { sourcesProcessed: number; itemsFetched: number; itemsScanned: number; itemsStored: number; errors: number }
  ): Promise<void> {
    this.calls.push('recordRunFinish');
  }

  async listSources(_limit: number): Promise<AgentASourceConfig[]> {
    this.calls.push('listSources');
    return [{
      id: 1,
      platform: 'reddit',
      source_id: 'SaaS',
      enabled: true,
      poll_interval_seconds: 600,
      max_items: 50,
      priority: 1,
    }];
  }

  async getCheckpoint(_platform: string, _sourceId: string): Promise<AgentACheckpoint | null> {
    this.calls.push('getCheckpoint');
    return this.checkpoints;
  }

  async upsertCheckpoint(checkpoint: AgentACheckpoint): Promise<void> {
    this.calls.push('upsertCheckpoint');
    this.checkpoints = checkpoint;
  }

  async storeRecord(_request: unknown): Promise<{ stored: boolean; record_id: string | null; deduped: boolean }> {
    this.calls.push('storeRecord');
    return { stored: true, record_id: '1', deduped: false };
  }
}

class FakeSourceReader {
  async readStream(_request: unknown): Promise<{ items: AgentARawItem[]; next_cursor: string | null }> {
    return {
      items: [{
        platform: 'reddit',
        source_id: 'SaaS',
        permalink: 'https://example.com',
        author: 'alice',
        created_at: new Date().toISOString(),
        raw_text: 'I need help with my CI failing',
        raw_html: null,
        metadata: {},
      }],
      next_cursor: 'next',
    };
  }
}

class FakeLLMHelper {
  public calls: string[] = [];

  async detectProblemSignal(_request: unknown): Promise<{ has_problem_signal: boolean; signal_markers: string[]; label: string; confidence: number }> {
    this.calls.push('detect');
    return { has_problem_signal: true, signal_markers: ['need help'], label: 'problem', confidence: 0.6 };
  }

  async extractProblemBlock(_request: unknown): Promise<{ problem_raw_text: string; surrounding_context: string }> {
    this.calls.push('extract');
    return { problem_raw_text: 'I need help', surrounding_context: '' };
  }

  async guessAuthorRole(_rawText: string): Promise<{ role_guess: string; confidence: number }> {
    this.calls.push('role');
    return { role_guess: 'unknown', confidence: 0.1 };
  }
}

describe('AgentAService', () => {
  test('runs pipeline in strict order per item', async () => {
    const storage = new FakeStorage();
    const reader = new FakeSourceReader();
    const llm = new FakeLLMHelper();

    const service = new AgentAService({
      storage,
      sourceReader: reader,
      llmHelper: llm,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const result = await service.tick({
      run_id: 'run-1',
      now: new Date().toISOString(),
      max_sources_per_tick: 1,
      max_items_per_source: 10,
      default_time_window: '6h',
    });

    expect(llm.calls).toEqual(['detect', 'extract', 'role']);
    expect(storage.calls).toContain('storeRecord');
    expect(result.items_stored).toBe(1);
  });
});
