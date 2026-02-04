import { jest } from '@jest/globals';
import { WebSearchTool } from '../../../src/infra/tools/implementations/web-search-tool.js';
import type { ToolContext } from '../../../src/infra/tools/tool-registry.js';

const mockFetch = jest.fn<any>();
global.fetch = mockFetch as any;

describe('WebSearchTool', () => {
  let tool: WebSearchTool;
  let context: ToolContext;

  beforeEach(() => {
    tool = new WebSearchTool();
    context = {} as any;
    mockFetch.mockReset();
    process.env.BRAVE_API_KEY = 'test-brave-key';
    process.env.PERPLEXITY_API_KEY = 'test-pplx-key';
  });

  afterEach(() => {
    delete process.env.BRAVE_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
  });

  test('should fail without query', async () => {
    await expect(tool.execute({}, context)).rejects.toThrow('query');
  });

  test('should fail without API key if provider is explicit', async () => {
    delete process.env.BRAVE_API_KEY;
    const result = await tool.execute({ query: 'foo', provider: 'brave' }, context);
    expect(result).toContain('Missing API key');
  });

  test('should fallback to DuckDuckGo if no keys', async () => {
    delete process.env.BRAVE_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html>... <a class="result__a" href="https://example.com">Example</a> ...</html>'
    });

    const result = await tool.execute({ query: 'foo' }, context);
    
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('duckduckgo.com'),
      expect.anything()
    );
    expect(result).toContain('"provider": "duckduckgo"');
    expect(result).toContain('https://example.com');
  });

  test('should search with Brave by default if key exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [{ title: 'Brave Result', url: 'https://brave.com', description: 'Test' }]
        }
      })
    });

    const result = await tool.execute({ query: 'test query' }, context);
    
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.search.brave.com'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Subscription-Token': 'test-brave-key' })
      })
    );
    expect(result).toContain('Brave Result');
  });

  test('should search with Perplexity when requested', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Perplexity Answer' } }],
        citations: ['http://cite.com']
      })
    });

    const result = await tool.execute({ query: 'test query', provider: 'perplexity' }, context);
    
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.perplexity.ai'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization': 'Bearer test-pplx-key' })
      })
    );
    expect(result).toContain('Perplexity Answer');
  });

  test('should cache results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } })
    });

    await tool.execute({ query: 'cache me' }, context);
    await tool.execute({ query: 'cache me' }, context);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
