import { extractMCPToolName } from '../../infra/mcp/adapters/tool-adapter.js';
import { findSkillsTool } from '../../infra/tools/implementations/find-skills-tool.js';
import type { SkillRegistry } from '../../infra/skills/skill-registry.js';
import type { ToolAllowlist, ToolEnforcer, ToolRegistry } from '../../infra/tools/tool-registry.js';
import type { WorkItem } from '../../work-order/types/index.js';
import type {
  ExecutionResourcePreparer,
  PreparedExecutionResources,
} from './execution-resource-preparer.js';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

interface ResourcePolicyConfig {
  available: string[];
  denied: string[];
}

interface McpSelector {
  serverPattern: string;
  toolPattern: string;
}

interface LocalExecutionResourcePreparerParams {
  skillRegistry: SkillRegistry;
  toolRegistry: ToolRegistry;
  toolAllowlist: ToolAllowlist;
  toolEnforcer: ToolEnforcer;
}

export class LocalExecutionResourcePreparer implements ExecutionResourcePreparer {
  private readonly logger: ILogger;

  constructor(
    private readonly params: LocalExecutionResourcePreparerParams,
    logger: ILogger = new NoopLogger()
  ) {
    this.logger = logger.child({ component: 'LocalExecutionResourcePreparer' });
  }

  async prepareForWorkItem(workItem: WorkItem): Promise<PreparedExecutionResources> {
    const resourceSelection = await this.applyResourcePolicySelection(workItem);
    if (resourceSelection.blocked) {
      return resourceSelection;
    }

    if (process.env.PONY_SKILL_AUTO_DISCOVERY !== 'false') {
      await this.preSearchSkills(workItem);
    }

    return { blocked: false };
  }

  private async preSearchSkills(workItem: WorkItem): Promise<void> {
    try {
      const policySnapshot = this.getPolicySnapshot(workItem);
      const skillPolicy = this.getResourcePolicy(policySnapshot?.skills);
      const hasPreferredSkills = skillPolicy.available.length > 0;
      const localSkillNames = this.params.skillRegistry.getSkills().map((skill) => skill.name);
      const localPreferred = this.filterBySelectors(localSkillNames, skillPolicy.available);

      if (hasPreferredSkills && localPreferred.length === 0) {
        const webSearchTool = this.params.toolRegistry.getTool('web_search');
        if (webSearchTool) {
          const queryHint = this.extractKeywords(workItem.description).slice(0, 2).join(' ');
          const skillSearchResult = await webSearchTool.execute(
            {
              query: `best PonyBunny skill ${queryHint}`,
              count: 5,
            },
            { cwd: process.cwd(), allowlist: this.params.toolAllowlist, enforcer: this.params.toolEnforcer }
          );

          workItem.context = {
            ...(workItem.context ?? {}),
            external_skill_discovery: this.removeDeniedMentions(skillSearchResult, skillPolicy.denied),
          };
        }
      }

      const keywords = this.extractKeywords(workItem.description);
      if (keywords.length === 0) return;

      const suggestedSkills: Array<Record<string, unknown>> = [];
      const searchLimit = Math.min(keywords.length, 3);

      for (let i = 0; i < searchLimit; i++) {
        const keyword = keywords[i];
        try {
          const searchResult = await findSkillsTool.execute(
            {
              query: keyword,
              install: false,
              limit: 2,
            },
            { cwd: process.cwd(), allowlist: this.params.toolAllowlist, enforcer: this.params.toolEnforcer }
          );

          const parsed = JSON.parse(searchResult);
          if (parsed.skills && Array.isArray(parsed.skills) && parsed.skills.length > 0) {
            const filtered = parsed.skills.filter((skill: { name?: unknown }) => {
              const skillName = skill.name;
              if (typeof skillName !== 'string') {
                return false;
              }
              if (skillPolicy.denied.some((selector) => this.matchesSelector(skillName, selector))) {
                return false;
              }
              if (skillPolicy.available.length > 0) {
                return skillPolicy.available.some((selector) => this.matchesSelector(skillName, selector));
              }
              return true;
            });

            suggestedSkills.push(...filtered);
          }
        } catch (error) {
          this.logger.warn({ keyword }, 'Skill pre-search failed for keyword');
        }
      }

      if (suggestedSkills.length > 0) {
        const uniqueSkills = this.deduplicateSkills(suggestedSkills);
        workItem.context = {
          ...workItem.context,
          suggestedSkills: uniqueSkills.slice(0, 5),
        };
        this.logger.info({ workItemId: workItem.id, skillCount: uniqueSkills.length }, 'Pre-searched skills for work item');
      }
    } catch (error) {
      this.logger.warn({}, 'Skill pre-search failed');
    }
  }

  private async applyResourcePolicySelection(workItem: WorkItem): Promise<PreparedExecutionResources> {
    const policySnapshot = this.getPolicySnapshot(workItem);
    if (!policySnapshot) {
      return { blocked: false };
    }

    const skillPolicy = this.getResourcePolicy(policySnapshot.skills);
    const mcpPolicy = this.getResourcePolicy(policySnapshot.mcp);
    const keywords = this.extractKeywords(`${workItem.title} ${workItem.description}`);

    const skillCandidates = this.rankCandidates(
      this.filterByPolicy(
        this.params.skillRegistry.getSkills().map((skill) => skill.name),
        skillPolicy
      ),
      keywords
    );

    const mcpTools = this.params.toolRegistry.getAllTools().map((tool) => tool.name).filter((name) => name.startsWith('mcp__'));
    const mcpCandidates = this.rankCandidates(
      this.filterMcpToolsByPolicy(mcpTools, mcpPolicy),
      keywords
    );

    const selectedSkillOverride = this.getString(workItem.context?.selected_skill_override);
    const selectedMcpOverride = this.getString(workItem.context?.selected_mcp_tool_override);

    const selectedSkill = selectedSkillOverride
      ?? (skillCandidates.length > 0 ? skillCandidates[0] : undefined);
    const selectedMcpTool = selectedMcpOverride
      ?? (mcpCandidates.length > 0 ? mcpCandidates[0] : undefined);

    const ambiguousSkillCandidates = selectedSkillOverride ? [] : skillCandidates.slice(0, 5);
    const ambiguousMcpCandidates = selectedMcpOverride ? [] : mcpCandidates.slice(0, 5);

    if (ambiguousSkillCandidates.length > 3 || ambiguousMcpCandidates.length > 3) {
      return {
        blocked: true,
        reason:
          'Too many resource candidates. Provide selected_skill_override or selected_mcp_tool_override via escalation response data. '
          + `skills=[${ambiguousSkillCandidates.join(', ') || 'none'}], mcp=[${ambiguousMcpCandidates.join(', ') || 'none'}]`,
      };
    }

    const baseAllowlist = this.toStringArray(workItem.context?.tool_allowlist);
    const selectedAllowlist = baseAllowlist.filter((toolName) => {
      if (!toolName.startsWith('mcp__')) {
        return true;
      }
      if (selectedMcpTool) {
        return toolName === selectedMcpTool;
      }
      return mcpCandidates.includes(toolName);
    });

    workItem.context = {
      ...(workItem.context ?? {}),
      selected_skill: selectedSkill,
      selected_mcp_tool: selectedMcpTool,
      candidate_skills: skillCandidates.slice(0, 5),
      candidate_mcp_tools: mcpCandidates.slice(0, 5),
      tool_allowlist: selectedAllowlist,
    };

    if (mcpPolicy.available.length > 0 && mcpCandidates.length === 0) {
      const webSearchTool = this.params.toolRegistry.getTool('web_search');
      if (webSearchTool) {
        const queryHint = keywords.slice(0, 2).join(' ');
        const mcpSearchResult = await webSearchTool.execute(
          {
            query: `best MCP server ${queryHint}`,
            count: 5,
          },
          { cwd: process.cwd(), allowlist: this.params.toolAllowlist, enforcer: this.params.toolEnforcer }
        );

        workItem.context = {
          ...(workItem.context ?? {}),
          external_mcp_discovery: this.removeDeniedMentions(mcpSearchResult, mcpPolicy.denied),
        };
      }
    }

    return { blocked: false };
  }

  private getPolicySnapshot(workItem: WorkItem): Record<string, unknown> | undefined {
    const snapshot = workItem.context?.policy_snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return undefined;
    }
    return snapshot as Record<string, unknown>;
  }

  private getResourcePolicy(value: unknown): ResourcePolicyConfig {
    if (!value || typeof value !== 'object') {
      return { available: [], denied: [] };
    }

    const record = value as Record<string, unknown>;
    return {
      available: this.toStringArray(record.available),
      denied: this.toStringArray(record.denied),
    };
  }

  private filterByPolicy(candidates: string[], policy: ResourcePolicyConfig): string[] {
    const byAvailable = policy.available.length > 0
      ? candidates.filter((name) => policy.available.some((selector) => this.matchesSelector(name, selector)))
      : candidates;

    return byAvailable.filter((name) => !policy.denied.some((selector) => this.matchesSelector(name, selector)));
  }

  private filterMcpToolsByPolicy(candidates: string[], policy: ResourcePolicyConfig): string[] {
    const availableSelectors = policy.available
      .map((selector) => this.parseMcpSelector(selector))
      .filter((selector): selector is McpSelector => selector !== undefined);
    const deniedSelectors = policy.denied
      .map((selector) => this.parseMcpSelector(selector))
      .filter((selector): selector is McpSelector => selector !== undefined);

    return candidates.filter((toolName) => {
      const parsed = extractMCPToolName(toolName);
      if (!parsed) {
        return false;
      }

      if (deniedSelectors.some((selector) => this.matchesMcpSelector(parsed.serverName, parsed.toolName, selector))) {
        return false;
      }

      if (policy.available.length === 0) {
        return true;
      }

      return availableSelectors.some((selector) => this.matchesMcpSelector(parsed.serverName, parsed.toolName, selector));
    });
  }

  private parseMcpSelector(selector: string): McpSelector | undefined {
    const trimmed = selector.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const dotIndex = trimmed.indexOf('.');
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
      return undefined;
    }

    const serverPattern = trimmed.slice(0, dotIndex).trim();
    const toolPattern = trimmed.slice(dotIndex + 1).trim();
    if (serverPattern.length === 0 || toolPattern.length === 0) {
      return undefined;
    }

    return { serverPattern, toolPattern };
  }

  private matchesMcpSelector(serverName: string, toolName: string, selector: McpSelector): boolean {
    return this.matchesSelector(serverName, selector.serverPattern)
      && this.matchesSelector(toolName, selector.toolPattern);
  }

  private rankCandidates(candidates: string[], keywords: string[]): string[] {
    const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
    return [...candidates].sort((left, right) => {
      const leftScore = lowerKeywords.reduce((score, keyword) => score + (left.toLowerCase().includes(keyword) ? 1 : 0), 0);
      const rightScore = lowerKeywords.reduce((score, keyword) => score + (right.toLowerCase().includes(keyword) ? 1 : 0), 0);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return left.localeCompare(right);
    });
  }

  private filterBySelectors(candidates: string[], selectors: string[]): string[] {
    if (selectors.length === 0) {
      return candidates;
    }

    return candidates.filter((candidate) => selectors.some((selector) => this.matchesSelector(candidate, selector)));
  }

  private matchesSelector(value: string, selector: string): boolean {
    const normalizedSelector = selector.trim();
    if (normalizedSelector.length === 0) {
      return false;
    }

    const escaped = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(value);
  }

  private removeDeniedMentions(content: string, deniedSelectors: string[]): string {
    let sanitized = content;
    for (const selector of deniedSelectors) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      const regex = new RegExp(escaped, 'ig');
      sanitized = sanitized.replace(regex, '[DENIED_FILTERED]');
    }
    return sanitized;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how']);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stopWords.has(word));

    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 5);
  }

  private deduplicateSkills(skills: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    const unique: Array<Record<string, unknown>> = [];

    for (const skill of skills) {
      const key = typeof skill.name === 'string'
        ? skill.name
        : typeof skill.url === 'string'
          ? skill.url
          : undefined;
      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(skill);
      }
    }

    return unique;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}
