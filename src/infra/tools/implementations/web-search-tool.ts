import type { ToolDefinition, ToolContext } from '../tool-registry.js';

interface WebSearchParams {
  query: string;
  count?: number;
  provider?: 'brave' | 'perplexity' | 'duckduckgo';
  country?: string; // e.g. 'US', 'GB'
  freshness?: 'pd' | 'pw' | 'pm' | 'py'; // Brave only: past day, week, month, year
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
  published?: string;
  siteName?: string;
}

interface CachedResult {
  timestamp: number;
  data: any;
}

export class WebSearchTool implements ToolDefinition {
  name = 'web_search';
  category = 'network' as const;
  riskLevel = 'safe' as const; // Search itself is safe, though content isn't controlled
  requiresApproval = false;
  description = 'Search the web using Brave (default) or Perplexity. Returns titles, URLs, and snippets.';

  private cache = new Map<string, CachedResult>();
  private readonly CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    const params = this.validateParams(args);
    
    // Check for explicit provider choice
    let provider = params.provider;
    let apiKey: string | undefined;

    // Default logic: Try Brave/Perplexity keys first, fallback to DuckDuckGo
    if (!provider) {
      if (this.getApiKey('brave')) {
        provider = 'brave';
        apiKey = this.getApiKey('brave');
      } else if (this.getApiKey('perplexity')) {
        provider = 'perplexity';
        apiKey = this.getApiKey('perplexity');
      } else {
        provider = 'duckduckgo';
      }
    } else {
      apiKey = this.getApiKey(provider);
    }

    if (provider !== 'duckduckgo' && !apiKey) {
      // If user explicitly asked for Brave/Perplexity but keys are missing, suggest DuckDuckGo
      return `Error: Missing API key for provider '${provider}'. Set BRAVE_API_KEY or PERPLEXITY_API_KEY, or use provider='duckduckgo'.`;
    }

    params.provider = provider;

    const cacheKey = this.getCacheKey(params);
    const cached = this.readCache(cacheKey);
    if (cached) {
      return JSON.stringify({ ...cached, cached: true }, null, 2);
    }

    try {
      let result;
      if (provider === 'perplexity' && apiKey) {
        result = await this.searchPerplexity(params, apiKey);
      } else if (provider === 'brave' && apiKey) {
        result = await this.searchBrave(params, apiKey);
      } else {
        result = await this.searchDuckDuckGo(params);
      }

      this.writeCache(cacheKey, result);
      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return `Search failed: ${error.message}`;
    }
  }

  private validateParams(args: Record<string, any>): WebSearchParams {
    if (!args.query || typeof args.query !== 'string') {
      throw new Error('Missing required argument: query');
    }

    const providerArg = args.provider;
    let provider: 'brave' | 'perplexity' | 'duckduckgo' | undefined;
    
    if (providerArg === 'perplexity') provider = 'perplexity';
    else if (providerArg === 'brave') provider = 'brave';
    else if (providerArg === 'duckduckgo') provider = 'duckduckgo';

    return {
      query: args.query,
      count: Math.min(Math.max(1, Number(args.count) || 5), 10),
      provider,
      country: typeof args.country === 'string' ? args.country : undefined,
      freshness: ['pd', 'pw', 'pm', 'py'].includes(args.freshness) ? args.freshness : undefined,
    };
  }

  private getApiKey(provider: string): string | undefined {
    if (provider === 'perplexity') {
      return process.env.PERPLEXITY_API_KEY || process.env.OPENROUTER_API_KEY;
    }
    return process.env.BRAVE_API_KEY;
  }

  private getCacheKey(params: WebSearchParams): string {
    return `${params.provider}:${params.query}:${params.count}:${params.country || ''}:${params.freshness || ''}`;
  }

  private readCache(key: string): any | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  private writeCache(key: string, data: any): void {
    this.cache.set(key, { timestamp: Date.now(), data });
    // Simple eviction policy: limit size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  private async searchBrave(params: WebSearchParams, apiKey: string): Promise<any> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', params.query);
    url.searchParams.set('count', String(params.count));
    if (params.country) url.searchParams.set('country', params.country);
    if (params.freshness) url.searchParams.set('freshness', params.freshness);

    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Brave API error (${res.status}): ${text}`);
    }

    const data = await res.json() as any;
    const results = (data.web?.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      published: r.age,
      siteName: this.getHostname(r.url),
    }));

    return {
      provider: 'brave',
      query: params.query,
      results,
    };
  }

  private async searchPerplexity(params: WebSearchParams, apiKey: string): Promise<any> {
    const baseUrl = 'https://api.perplexity.ai'; // Or OpenRouter if needed
    const model = 'sonar-pro'; // Default from OpenClaw

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: params.query }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Perplexity API error (${res.status}): ${text}`);
    }

    const data = await res.json() as any;
    return {
      provider: 'perplexity',
      query: params.query,
      content: data.choices?.[0]?.message?.content || 'No response',
      citations: data.citations || [],
    };
  }

  private async searchDuckDuckGo(params: WebSearchParams): Promise<any> {
    const url = new URL('https://html.duckduckgo.com/html/');
    const formData = new URLSearchParams();
    formData.append('q', params.query);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DuckDuckGo error (${res.status}): ${text}`);
    }

    const html = await res.text();
    const results: any[] = [];

    // Simple regex parsing for DuckDuckGo HTML results
    // Looking for <a class="result__a" href="...">Title</a>
    // and <a class="result__snippet" ...>Snippet</a>
    
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g;
    const snippetRegex = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/g;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      if (results.length >= (params.count || 5)) break;
      
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, ''); // Strip tags from title
      
      results.push({
        title,
        url,
        description: '', // Will fill below
        siteName: this.getHostname(url),
      });
    }

    // Fill snippets (assuming order matches, which is risky but often true for DDG HTML)
    let snippetIndex = 0;
    while ((match = snippetRegex.exec(html)) !== null && snippetIndex < results.length) {
      results[snippetIndex].description = match[1].replace(/<[^>]+>/g, '');
      snippetIndex++;
    }

    return {
      provider: 'duckduckgo',
      query: params.query,
      results,
    };
  }

  private getHostname(url: string): string | undefined {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }
}
