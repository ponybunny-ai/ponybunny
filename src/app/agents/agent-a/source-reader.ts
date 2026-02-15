import type {
  AgentASourceReadRequest,
  AgentASourceReadResult,
  AgentARawItem,
  AgentAPlatform,
  AgentALimitsConfig,
} from './types.js';
import { MCPToolExecutor, parseJsonResult, extractTextFromResult } from './mcp-tool-executor.js';
import type { IMCPToolExecutor } from './mcp-tool-executor.js';

type MCPPayload = Record<string, unknown> | unknown[];

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function extractItems(payload: MCPPayload, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (record[key]) return asArray(record[key]);
  }
  if (record.items) return asArray(record.items);
  return [];
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function normalizeRawItem(
  item: AgentARawItem,
  limits: AgentALimitsConfig
): AgentARawItem {
  const { text, truncated } = truncateText(item.raw_text, limits.raw_text_max_chars);
  return {
    ...item,
    raw_text: text,
    metadata: {
      ...item.metadata,
      truncated: truncated || item.metadata.truncated === true,
    },
  };
}

function pickText(fields: Array<string | undefined | null>): string {
  return fields.filter(Boolean).join('\n\n');
}

export class AgentASourceReader {
  constructor(
    private executor: IMCPToolExecutor = new MCPToolExecutor(),
    private limits: AgentALimitsConfig
  ) {}

  async readStream(request: AgentASourceReadRequest): Promise<AgentASourceReadResult> {
    switch (request.platform) {
      case 'reddit':
        return this.readReddit(request);
      case 'github':
        return this.readGitHub(request);
      case 'forum_web':
        return this.readForum(request);
      default:
        return { items: [], next_cursor: request.cursor, error: 'Unsupported platform' };
    }
  }

  private async readReddit(request: AgentASourceReadRequest): Promise<AgentASourceReadResult> {
    try {
      const postsResult = await this.executor.callTool('reddit', 'reddit.list_new_posts', {
        subreddit: request.source_id,
        after: request.cursor,
        limit: request.max_items,
      });

      const commentsResult = await this.executor.callTool('reddit', 'reddit.list_new_comments', {
        subreddit: request.source_id,
        after: request.cursor,
        limit: request.max_items,
      });

      const postsPayload = parseJsonResult<MCPPayload>(postsResult);
      const commentsPayload = parseJsonResult<MCPPayload>(commentsResult);

      const posts = extractItems(postsPayload, ['posts', 'data', 'children']);
      const comments = extractItems(commentsPayload, ['comments', 'data', 'children']);

      const items: AgentARawItem[] = [];
      for (const post of posts) {
        const record = post as Record<string, any>;
        const permalink = record.permalink || record.url || '';
        const rawText = pickText([record.title, record.selftext, record.body, record.text]);
        items.push(normalizeRawItem({
          platform: 'reddit',
          source_id: request.source_id,
          permalink: permalink || `${request.source_id}#post-${record.id || ''}`,
          author: record.author ?? null,
          created_at: record.created_utc ? new Date(record.created_utc * 1000).toISOString() : null,
          raw_text: rawText || '',
          raw_html: record.selftext_html ?? null,
          metadata: record,
        }, this.limits));
      }

      for (const comment of comments) {
        const record = comment as Record<string, any>;
        const permalink = record.permalink || record.link_permalink || '';
        const rawText = pickText([record.body, record.text]);
        items.push(normalizeRawItem({
          platform: 'reddit',
          source_id: request.source_id,
          permalink: permalink || `${request.source_id}#comment-${record.id || ''}`,
          author: record.author ?? null,
          created_at: record.created_utc ? new Date(record.created_utc * 1000).toISOString() : null,
          raw_text: rawText || '',
          raw_html: record.body_html ?? null,
          metadata: record,
        }, this.limits));
      }

      return {
        items: items.slice(0, request.max_items),
        next_cursor: request.cursor,
      };
    } catch (error) {
      return { items: [], next_cursor: request.cursor, error: String(error) };
    }
  }

  private async readGitHub(request: AgentASourceReadRequest): Promise<AgentASourceReadResult> {
    try {
      const issuesResult = await this.executor.callTool('github', 'github.list_issues', {
        repo: request.source_id,
        since: request.cursor,
        state: 'all',
      });

      const issuesPayload = parseJsonResult<MCPPayload>(issuesResult);
      const issues = extractItems(issuesPayload, ['issues', 'items']);

      const items: AgentARawItem[] = [];

      for (const issue of issues) {
        const record = issue as Record<string, any>;
        const rawText = pickText([record.title, record.body]);
        const permalink = record.html_url || record.url || '';
        items.push(normalizeRawItem({
          platform: 'github',
          source_id: request.source_id,
          permalink: permalink || `${request.source_id}#issue-${record.number || ''}`,
          author: record.user?.login ?? null,
          created_at: record.created_at ?? null,
          raw_text: rawText || '',
          raw_html: null,
          metadata: record,
        }, this.limits));

        if (record.number) {
          const commentsResult = await this.executor.callTool('github', 'github.list_issue_comments', {
            repo: request.source_id,
            issue_number: record.number,
            since: request.cursor,
          });
          const commentsPayload = parseJsonResult<MCPPayload>(commentsResult);
          const comments = extractItems(commentsPayload, ['comments', 'items']);
          for (const comment of comments) {
            const commentRecord = comment as Record<string, any>;
            const commentText = pickText([commentRecord.body]);
            const commentLink = commentRecord.html_url || commentRecord.url || '';
            items.push(normalizeRawItem({
              platform: 'github',
              source_id: request.source_id,
              permalink: commentLink || `${request.source_id}#comment-${commentRecord.id || ''}`,
              author: commentRecord.user?.login ?? null,
              created_at: commentRecord.created_at ?? null,
              raw_text: commentText || '',
              raw_html: null,
              metadata: commentRecord,
            }, this.limits));
          }
        }
      }

      return {
        items: items.slice(0, request.max_items),
        next_cursor: request.cursor,
      };
    } catch (error) {
      return { items: [], next_cursor: request.cursor, error: String(error) };
    }
  }

  private async readForum(request: AgentASourceReadRequest): Promise<AgentASourceReadResult> {
    try {
      await this.executor.callTool('playwright', 'playwright.navigate', {
        url: request.source_id,
      });

      const contentResult = await this.executor.callTool('playwright', 'playwright.get_content', {
        mode: 'text',
      });

      const text = extractTextFromResult(contentResult);

      const item = normalizeRawItem({
        platform: 'forum_web',
        source_id: request.source_id,
        permalink: request.source_id,
        author: null,
        created_at: null,
        raw_text: text,
        raw_html: null,
        metadata: { url: request.source_id },
      }, this.limits);

      return {
        items: [item].slice(0, request.max_items),
        next_cursor: request.cursor,
      };
    } catch (error) {
      return { items: [], next_cursor: request.cursor, error: String(error) };
    }
  }
}
