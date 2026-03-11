import { findSkillsTool } from '../../../src/infra/tools/implementations/find-skills-tool.js';
import { ToolAllowlist, ToolEnforcer, ToolRegistry, type ToolDefinition } from '../../../src/infra/tools/tool-registry.js';
import { LocalExecutionResourcePreparer } from '../../../src/runtime/execution-boundary/local-execution-resource-preparer.js';
import type { WorkItem } from '../../../src/work-order/types/index.js';

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = Date.now();
  return {
    id: overrides.id ?? `wi-${now}`,
    created_at: now,
    updated_at: now,
    goal_id: overrides.goal_id ?? 'goal-1',
    title: overrides.title ?? 'Select integration',
    description: overrides.description ?? 'Pick the best GitHub repository search path',
    item_type: overrides.item_type ?? 'analysis',
    status: overrides.status ?? 'ready',
    priority: overrides.priority ?? 1,
    dependencies: overrides.dependencies ?? [],
    blocks: overrides.blocks ?? [],
    assigned_agent: overrides.assigned_agent,
    estimated_effort: overrides.estimated_effort ?? 'S',
    retry_count: overrides.retry_count ?? 0,
    max_retries: overrides.max_retries ?? 1,
    verification_plan: overrides.verification_plan,
    verification_status: overrides.verification_status ?? 'not_started',
    context: overrides.context,
  };
}

function createTool(name: string, execute?: ToolDefinition['execute']): ToolDefinition {
  return {
    name,
    category: 'network',
    riskLevel: 'safe',
    requiresApproval: false,
    description: name,
    execute: execute ?? jest.fn().mockResolvedValue(''),
  };
}

describe('LocalExecutionResourcePreparer', () => {
  const originalAutoDiscovery = process.env.PONY_SKILL_AUTO_DISCOVERY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAutoDiscovery === undefined) {
      delete process.env.PONY_SKILL_AUTO_DISCOVERY;
      return;
    }
    process.env.PONY_SKILL_AUTO_DISCOVERY = originalAutoDiscovery;
  });

  it('preserves resource-selection narrowing semantics for selected skill and MCP tool', async () => {
    process.env.PONY_SKILL_AUTO_DISCOVERY = 'false';

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(createTool('web_search'));
    toolRegistry.register(createTool('mcp__github__search_repositories'));
    toolRegistry.register(createTool('mcp__gitlab__search_projects'));

    const toolAllowlist = new ToolAllowlist([
      'read_file',
      'mcp__github__search_repositories',
      'mcp__gitlab__search_projects',
    ]);
    const toolEnforcer = new ToolEnforcer(toolRegistry, toolAllowlist);
    const preparer = new LocalExecutionResourcePreparer({
      skillRegistry: {
        getSkills: () => [{ name: 'github-search' }, { name: 'gitlab-search' }],
      } as any,
      toolRegistry,
      toolAllowlist,
      toolEnforcer,
    });

    const workItem = createWorkItem({
      context: {
        policy_snapshot: {
          skills: {
            available: ['*'],
            denied: [],
          },
          mcp: {
            available: ['github.*', 'gitlab.*'],
            denied: [],
          },
        },
        tool_allowlist: ['read_file', 'mcp__github__search_repositories', 'mcp__gitlab__search_projects'],
      },
    });

    const result = await preparer.prepareForWorkItem(workItem);

    expect(result).toEqual({ blocked: false });
    expect(workItem.context).toEqual(
      expect.objectContaining({
        selected_skill: 'github-search',
        selected_mcp_tool: 'mcp__github__search_repositories',
        candidate_skills: ['github-search', 'gitlab-search'],
        candidate_mcp_tools: ['mcp__github__search_repositories', 'mcp__gitlab__search_projects'],
        tool_allowlist: ['read_file', 'mcp__github__search_repositories'],
      })
    );
  });

  it('preserves skill pre-search suggestion semantics through the extracted seam', async () => {
    process.env.PONY_SKILL_AUTO_DISCOVERY = 'true';
    jest.spyOn(findSkillsTool, 'execute').mockResolvedValue(
      JSON.stringify({
        skills: [
          { name: 'github-search', url: 'https://skills/github-search' },
          { name: 'gitlab-search', url: 'https://skills/gitlab-search' },
          { name: 'github-search', url: 'https://skills/github-search' },
        ],
      })
    );

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(createTool('web_search'));
    const toolAllowlist = new ToolAllowlist(['find_skills', 'web_search']);
    const toolEnforcer = new ToolEnforcer(toolRegistry, toolAllowlist);
    const preparer = new LocalExecutionResourcePreparer({
      skillRegistry: {
        getSkills: () => [],
      } as any,
      toolRegistry,
      toolAllowlist,
      toolEnforcer,
    });

    const workItem = createWorkItem({
      title: 'Need skill ideas',
      description: 'Search GitHub repositories and inspect repository metadata',
      context: {
        policy_snapshot: {
          skills: {
            available: ['github*'],
            denied: ['gitlab*'],
          },
        },
      },
    });

    const result = await preparer.prepareForWorkItem(workItem);

    expect(result).toEqual({ blocked: false });
    expect(findSkillsTool.execute).toHaveBeenCalled();
    expect(workItem.context).toEqual(
      expect.objectContaining({
        suggestedSkills: [
          { name: 'github-search', url: 'https://skills/github-search' },
        ],
      })
    );
  });
});
