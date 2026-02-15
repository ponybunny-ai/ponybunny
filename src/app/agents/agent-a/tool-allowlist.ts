const FORBIDDEN_SUFFIXES = [
  '.post',
  '.reply',
  '.send_message',
];

const FORBIDDEN_PREFIXES = [
  'create_',
  'update_',
  'delete_',
];

const MCP_ALLOWLIST: Record<string, Set<string>> = {
  playwright: new Set([
    'playwright.navigate',
    'playwright.get_content',
    'playwright.query_selector_all',
  ]),
  reddit: new Set([
    'reddit.list_new_posts',
    'reddit.list_new_comments',
  ]),
  github: new Set([
    'github.list_issues',
    'github.list_issue_comments',
  ]),
  postgres: new Set([
    'pg.select',
    'pg.insert',
    'pg.execute',
  ]),
};

const LLM_ALLOWLIST = new Set([
  'llm.extract_json',
  'llm.classify',
]);

export function isForbiddenTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (FORBIDDEN_SUFFIXES.some(suffix => lower.endsWith(suffix))) {
    return true;
  }
  if (FORBIDDEN_PREFIXES.some(prefix => lower.includes(`.${prefix}`) || lower.startsWith(prefix))) {
    return true;
  }
  return false;
}

export function isAllowedLLMTool(toolName: string): boolean {
  return LLM_ALLOWLIST.has(toolName);
}

export function isAllowedMCPTool(serverName: string, toolName: string): boolean {
  const allowed = MCP_ALLOWLIST[serverName];
  if (!allowed) return false;
  return allowed.has(toolName);
}

export function assertAllowedTool(serverName: string, toolName: string): void {
  if (isForbiddenTool(toolName)) {
    throw new Error(`Tool '${toolName}' is explicitly forbidden`);
  }

  const isLLM = toolName.startsWith('llm.');
  if (isLLM && !isAllowedLLMTool(toolName)) {
    throw new Error(`LLM tool '${toolName}' is not allowed`);
  }

  if (!isLLM && !isAllowedMCPTool(serverName, toolName)) {
    throw new Error(`MCP tool '${toolName}' is not allowed for server '${serverName}'`);
  }
}
