import type {
  SystemPromptContext,
  SystemPromptSection,
  SystemPromptBuildResult,
  PromptMode,
  AgentPhase,
  ToolSummary,
} from './types.js';
import { loadPromptTemplate, renderPromptTemplate } from './template-loader.js';
import { promptDebugDump, promptDebugLog } from './prompt-debug.js';

const BRAND_NAME = 'PonyBunny';
const BRAND_CONTEXT =
  'PonyBunny is an Autonomous AI Employee System built on a Gateway + Scheduler architecture. ' +
  'You operate within the 8-phase lifecycle: Intake → Elaboration → Planning → Execution → Verification → Evaluation → Publish → Monitor.';

const PHASE_DESCRIPTIONS: Record<AgentPhase, string> = {
  intake: 'validating and understanding the goal requirements',
  elaboration: 'detecting ambiguities and gathering clarifications',
  planning: 'decomposing the goal into a structured execution plan',
  execution: 'autonomously executing work items',
  verification: 'validating quality and completeness of deliverables',
  evaluation: 'deciding whether to publish, retry, or escalate',
  publish: 'packaging results and generating summaries',
  monitor: 'tracking metrics and budget utilization',
  conversation: 'engaging with the user in natural conversation',
};

export class SystemPromptBuilder {
  private sections: SystemPromptSection[] = [];

  constructor(private context: SystemPromptContext) {}

  build(): SystemPromptBuildResult {
    this.sections = [];
    const mode = this.context.promptMode ?? 'full';
    const phase = this.context.agentPhase;

    promptDebugLog('build', `phase=${phase} mode=${mode}`);

    this.addIdentitySection(mode, phase);
    this.addToolingSection(mode);
    this.addProviderToolEnvelopeSection(mode);
    this.addToolCallStyleSection(mode);
    this.addSafetySection(mode);
    this.addSkillsSection(mode);
    this.addMemorySection(mode);
    this.addWorkspaceSection(mode);
    this.addPhaseSpecificSection(mode, phase);
    this.addProjectContextSection(mode);
    this.addRuntimeSection(mode);
    this.addExtraSection();

    const filteredSections = this.filterSections(this.sections, mode, phase);
    const prompt = filteredSections.map(s => s.content).join('\n\n');

    promptDebugLog('build', `sections=${filteredSections.length} tools=${this.context.availableTools.length} skills=${this.context.availableSkills?.length ?? 0}`);
    promptDebugDump('Final System Prompt', prompt);

    return {
      prompt,
      sections: filteredSections,
      metadata: {
        phase,
        mode,
        toolCount: this.context.availableTools.length,
        skillCount: this.context.availableSkills?.length ?? 0,
        sectionCount: filteredSections.length,
      },
    };
  }

  private getTemplate(templateName: string, values: Record<string, string> = {}): string {
    const loaded = loadPromptTemplate(templateName);
    promptDebugLog('template', `name=${templateName} path=${loaded.path}`);
    return renderPromptTemplate(loaded.content, values);
  }

  private filterSections(sections: SystemPromptSection[], mode: PromptMode, phase: AgentPhase): SystemPromptSection[] {
    return sections.filter(section => {
      if (section.modeFilter && !section.modeFilter.includes(mode)) {
        return false;
      }
      if (section.phaseFilter && !section.phaseFilter.includes(phase)) {
        return false;
      }
      return true;
    });
  }

  private addIdentitySection(mode: PromptMode, phase: AgentPhase): void {
    const templateName = mode === 'none' ? 'system-none.md' : 'system.md';
    const content = this.getTemplate(templateName, {
      AGENT_PHASE: phase,
      PHASE_DESCRIPTION: PHASE_DESCRIPTIONS[phase],
      BRAND_CONTEXT,
      BRAND_NAME,
    });

    this.sections.push({
      name: 'Identity',
      content,
      required: true,
    });

    promptDebugLog('inject', 'Identity section');
  }

  private addToolingSection(mode: PromptMode): void {
    if (mode === 'none') {
      return;
    }

    const tools = this.context.availableTools;
    if (tools.length === 0) {
      promptDebugLog('inject', 'Tooling skipped: no tools');
      return;
    }

    const toolsByCategory = this.groupToolsByCategory(tools);
    const lines: string[] = [this.getTemplate('tooling.md').trimEnd(), ''];

    if (toolsByCategory.core.length > 0) {
      lines.push('### Core Tools');
      for (const tool of toolsByCategory.core) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    if (toolsByCategory.domain.length > 0) {
      lines.push('### Domain Tools');
      for (const tool of toolsByCategory.domain) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    if (toolsByCategory.skill.length > 0) {
      lines.push('### Skill Tools');
      for (const tool of toolsByCategory.skill) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    if (toolsByCategory.mcp.length > 0) {
      lines.push('### MCP Tools');
      for (const tool of toolsByCategory.mcp) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    this.sections.push({
      name: 'Tooling',
      content: lines.join('\n'),
      required: true,
    });

    promptDebugLog(
      'inject',
      `Tooling section core=${toolsByCategory.core.length} domain=${toolsByCategory.domain.length} skill=${toolsByCategory.skill.length} mcp=${toolsByCategory.mcp.length}`
    );
  }

  private addToolCallStyleSection(mode: PromptMode): void {
    if (mode === 'none' || mode === 'minimal') {
      return;
    }

    const content = this.getTemplate('tool-call-style.md');
    this.sections.push({
      name: 'ToolCallStyle',
      content,
      required: false,
      modeFilter: ['full'],
    });

    promptDebugLog('inject', 'ToolCallStyle section');
  }

  private addProviderToolEnvelopeSection(mode: PromptMode): void {
    if (mode === 'none') {
      return;
    }

    const routeContext = this.context.routeContext;
    const toolPolicyAudit = this.context.toolPolicyAudit;

    if (!routeContext && !toolPolicyAudit) {
      return;
    }

    const lines: string[] = ['## Provider-Aware Tool Envelope', ''];

    if (routeContext) {
      lines.push(
        `route.source=${routeContext.source} | route.provider=${routeContext.providerId || 'unspecified'} | route.channel=${routeContext.channel || 'unspecified'} | route.agent=${routeContext.agentId || 'unspecified'}`
      );
      lines.push(
        `route.owner=${routeContext.senderIsOwner === true ? 'true' : 'false'} | route.sandboxed=${routeContext.sandboxed === true ? 'true' : 'false'} | route.subagent=${routeContext.isSubagent === true ? 'true' : 'false'}`
      );
      lines.push('');
    }

    if (toolPolicyAudit) {
      lines.push(
        `policy.layered=${toolPolicyAudit.hasLayeredPolicy ? 'true' : 'false'} | policy.layers=${toolPolicyAudit.appliedLayers.join(' -> ') || 'none'}`
      );
      lines.push(
        `tools.baseline=${toolPolicyAudit.baselineAllowedTools.length} | tools.effective=${toolPolicyAudit.effectiveAllowedTools.length} | tools.denied=${toolPolicyAudit.deniedTools.length}`
      );
      if (toolPolicyAudit.deniedTools.length > 0) {
        lines.push('Denied tools:');
        for (const denied of toolPolicyAudit.deniedTools) {
          lines.push(`- ${denied.tool}: ${denied.reason}`);
        }
      }
      lines.push('');
    }

    this.sections.push({
      name: 'ProviderToolEnvelope',
      content: lines.join('\n'),
      required: false,
    });

    promptDebugLog('inject', 'ProviderToolEnvelope section');
  }

  private addSafetySection(mode: PromptMode): void {
    if (mode === 'none') {
      return;
    }

    const safetyLevel = this.context.safetyLevel ?? 'standard';
    const escalationEnabled = this.context.escalationEnabled ?? true;

    const lines: string[] = ['## Safety', ''];

    if (safetyLevel === 'maximum' || mode === 'full') {
      lines.push(this.getTemplate('safety-core.md').trimEnd(), '');
    }

    if (escalationEnabled) {
      lines.push(this.getTemplate('safety-escalation.md').trimEnd(), '');
    }

    if (this.context.budgetTokens) {
      const spent = this.context.spentTokens ?? 0;
      const remaining = this.context.budgetTokens - spent;
      const percentUsed = Math.round((spent / this.context.budgetTokens) * 100);
      lines.push(
        this.getTemplate('safety-budget.md', {
          BUDGET_TOKENS: String(this.context.budgetTokens),
          SPENT_TOKENS: String(spent),
          PERCENT_USED: String(percentUsed),
          REMAINING_TOKENS: String(remaining),
        }).trimEnd(),
        ''
      );
    }

    this.sections.push({
      name: 'Safety',
      content: lines.join('\n'),
      required: true,
    });

    promptDebugLog('inject', `Safety section level=${safetyLevel} escalation=${escalationEnabled}`);
  }

  private addSkillsSection(mode: PromptMode): void {
    if (mode === 'minimal' || mode === 'none') {
      return;
    }

    const skills = this.context.availableSkills ?? [];
    if (skills.length === 0 && !this.context.skillsPrompt) {
      promptDebugLog('inject', 'Skills skipped: no skills and no skills prompt');
      return;
    }

    const lines: string[] = [this.getTemplate('skills.md').trimEnd(), ''];

    if (this.context.skillsPrompt) {
      lines.push(this.context.skillsPrompt);
    } else if (skills.length > 0) {
      lines.push('<available_skills>');
      for (const skill of skills) {
        lines.push('  <skill>');
        lines.push(`    <name>${skill.name}</name>`);
        lines.push(`    <description>${skill.description}</description>`);
        lines.push(`    <location>${skill.location}</location>`);
        if (skill.eligibility?.phase) {
          lines.push(`    <phases>${skill.eligibility.phase.join(', ')}</phases>`);
        }
        lines.push('  </skill>');
      }
      lines.push('</available_skills>');
    }

    this.sections.push({
      name: 'Skills',
      content: lines.join('\n'),
      required: false,
      modeFilter: ['full'],
    });

    promptDebugLog('inject', `Skills section count=${skills.length} skillsPrompt=${this.context.skillsPrompt ? 'yes' : 'no'}`);
  }

  private addMemorySection(mode: PromptMode): void {
    if (mode === 'minimal' || mode === 'none') {
      return;
    }
    if (!this.context.memoryEnabled) {
      return;
    }

    const citationsEnabled = this.context.citationsEnabled ?? true;
    const lines: string[] = [this.getTemplate('memory.md').trimEnd(), ''];

    if (citationsEnabled) {
      lines.push('**Citations**: Include `Source: <path#line>` when citing memory to help user verify.', '');
    } else {
      lines.push('**Citations disabled**: Do not mention file paths or line numbers unless explicitly asked.', '');
    }

    this.sections.push({
      name: 'Memory',
      content: lines.join('\n'),
      required: false,
      modeFilter: ['full'],
    });

    promptDebugLog('inject', `Memory section citations=${citationsEnabled}`);
  }

  private addWorkspaceSection(mode: PromptMode): void {
    if (mode === 'none') {
      return;
    }

    const lines: string[] = [
      this.getTemplate('workspace.md', {
        WORKSPACE_DIR: this.context.workspaceDir,
      }).trimEnd(),
      '',
    ];

    if (this.context.goalId) {
      lines.push(`**Current Goal**: ${this.context.goalId}`);
      if (this.context.goalTitle) {
        lines.push(`**Goal Title**: ${this.context.goalTitle}`);
      }
      if (this.context.goalDescription) {
        lines.push(`**Goal Description**: ${this.context.goalDescription}`);
      }
      lines.push('');
    }

    this.sections.push({
      name: 'Workspace',
      content: lines.join('\n'),
      required: true,
    });

    promptDebugLog('inject', `Workspace section goal=${this.context.goalId ?? 'none'}`);
  }

  private addPhaseSpecificSection(mode: PromptMode, phase: AgentPhase): void {
    if (mode === 'none') {
      return;
    }

    const guidance = this.getTemplate(`phase-${phase}.md`).trimEnd();
    this.sections.push({
      name: 'PhaseGuidance',
      content: `## Phase: ${phase}\n\n${guidance}`,
      required: false,
      phaseFilter: [phase],
    });

    promptDebugLog('inject', `PhaseGuidance section phase=${phase}`);
  }

  private addProjectContextSection(mode: PromptMode): void {
    if (mode === 'minimal' || mode === 'none') {
      return;
    }

    const contextFiles = this.context.projectContext ?? [];
    if (contextFiles.length === 0) {
      return;
    }

    const lines: string[] = [this.getTemplate('project-context.md').trimEnd(), ''];
    for (const file of contextFiles) {
      lines.push(`### ${file.filename}`, '', file.content, '');
    }

    this.sections.push({
      name: 'ProjectContext',
      content: lines.join('\n'),
      required: false,
      modeFilter: ['full'],
    });

    promptDebugLog('inject', `ProjectContext section files=${contextFiles.length}`);
  }

  private addRuntimeSection(mode: PromptMode): void {
    if (mode === 'none') {
      return;
    }

    const parts: string[] = [];
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    parts.push(`current_date=${dateStr}`);
    parts.push(`current_time=${timeStr}`);
    parts.push(`timezone=${timezone}`);

    if (this.context.modelName) {
      parts.push(`model=${this.context.modelName}`);
    }
    if (this.context.runtimeInfo?.platform) {
      parts.push(`platform=${this.context.runtimeInfo.platform}`);
    }
    if (this.context.runtimeInfo?.nodeVersion) {
      parts.push(`node=${this.context.runtimeInfo.nodeVersion}`);
    }
    if (this.context.runtimeInfo?.cwd) {
      parts.push(`cwd=${this.context.runtimeInfo.cwd}`);
    }
    if (this.context.modelCapabilities?.reasoning) {
      parts.push('reasoning=enabled');
    }

    if (parts.length === 0) {
      return;
    }

    this.sections.push({
      name: 'Runtime',
      content: `${this.getTemplate('runtime.md').trimEnd()}\n\n${parts.join(' | ')}`,
      required: false,
    });

    promptDebugLog('inject', `Runtime section parts=${parts.length}`);
  }

  private addExtraSection(): void {
    if (!this.context.extraSystemPrompt) {
      return;
    }

    this.sections.push({
      name: 'ExtraContext',
      content: `${this.getTemplate('additional-context.md').trimEnd()}\n\n${this.context.extraSystemPrompt}`,
      required: false,
    });

    promptDebugLog('inject', 'Additional context section');
  }

  private groupToolsByCategory(tools: ToolSummary[]): Record<string, ToolSummary[]> {
    const result: Record<string, ToolSummary[]> = {
      core: [],
      domain: [],
      skill: [],
      mcp: [],
    };

    for (const tool of tools) {
      const category = tool.category ?? 'core';
      if (!result[category]) {
        result[category] = [];
      }
      result[category].push(tool);
    }

    return result;
  }
}

export function buildSystemPrompt(context: SystemPromptContext): SystemPromptBuildResult {
  const builder = new SystemPromptBuilder(context);
  return builder.build();
}
