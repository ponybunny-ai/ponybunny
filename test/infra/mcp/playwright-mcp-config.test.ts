import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MCP_TEMPLATE = path.join(REPO_ROOT, 'docs', 'config-templates', 'mcp-config.example.json');

describe('Playwright MCP configuration template', () => {
  let config: Record<string, unknown>;

  beforeAll(() => {
    config = JSON.parse(fs.readFileSync(MCP_TEMPLATE, 'utf-8'));
  });

  it('template file exists and is valid JSON', () => {
    expect(config).toBeDefined();
    expect(config.mcpServers).toBeDefined();
  });

  it('contains playwright server definition', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.playwright).toBeDefined();
  });

  it('playwright uses stdio transport with npx command', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    const pw = servers.playwright;
    expect(pw.transport).toBe('stdio');
    expect(pw.command).toBe('npx');
    expect(pw.args).toEqual(['-y', '@playwright/mcp@latest']);
  });

  it('playwright is disabled by default (safe default)', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.playwright.enabled).toBe(false);
  });

  it('playwright allowedTools includes core browser operations', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    const tools = servers.playwright.allowedTools as string[];
    expect(tools).toContain('browser_navigate');
    expect(tools).toContain('browser_screenshot');
    expect(tools).toContain('browser_click');
    expect(tools).toContain('browser_type');
    expect(tools).toContain('browser_evaluate');
  });

  it('playwright has timeout configured', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.playwright.timeout).toBe(60000);
  });

  it('playwright has autoReconnect enabled', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.playwright.autoReconnect).toBe(true);
  });

  it('does not include destructive browser tools', () => {
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;
    const tools = servers.playwright.allowedTools as string[];
    // Ensure no wildcard that would include dangerous tools
    expect(tools).not.toContain('*');
    // browser_close is allowed (cleanup)
    expect(tools).toContain('browser_close');
  });
});
