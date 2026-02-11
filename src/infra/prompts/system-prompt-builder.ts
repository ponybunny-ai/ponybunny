/**
 * System Prompt Builder
 * Builds modular, phase-aware system prompts inspired by OpenClaw architecture
 */

import type {
  SystemPromptContext,
  SystemPromptSection,
  SystemPromptBuildResult,
  PromptMode,
  AgentPhase,
  ToolSummary,
} from './types.js';

export class SystemPromptBuilder {
  private sections: SystemPromptSection[] = [];

  constructor(private context: SystemPromptContext) {}

  build(): SystemPromptBuildResult {
    this.sections = [];
    const mode = this.context.promptMode ?? 'full';
    const phase = this.context.agentPhase;

    // Build sections in order
    this.addIdentitySection(mode, phase);
    this.addToolingSection(mode, phase);
    this.addToolCallStyleSection(mode, phase);
    this.addSafetySection(mode, phase);
    this.addSkillsSection(mode, phase);
    this.addMemorySection(mode, phase);
    this.addWorkspaceSection(mode, phase);
    this.addPhaseSpecificSection(mode, phase);
    this.addProjectContextSection(mode, phase);
    this.addRuntimeSection(mode, phase);
    this.addExtraSection(mode, phase);

    // Filter sections by mode and phase
    const filteredSections = this.filterSections(this.sections, mode, phase);

    // Build final prompt
    const prompt = filteredSections.map(s => s.content).join('\n\n');

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

  private filterSections(
    sections: SystemPromptSection[],
    mode: PromptMode,
    phase: AgentPhase
  ): SystemPromptSection[] {
    return sections.filter(section => {
      // Check mode filter
      if (section.modeFilter && !section.modeFilter.includes(mode)) {
        return false;
      }

      // Check phase filter
      if (section.phaseFilter && !section.phaseFilter.includes(phase)) {
        return false;
      }

      return true;
    });
  }

  private addIdentitySection(mode: PromptMode, phase: AgentPhase): void {
    const phaseDescriptions: Record<AgentPhase, string> = {
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

    const identity =
      mode === 'none'
        ? 'You are an autonomous AI agent running inside PonyBunny.'
        : `You are an autonomous AI agent running inside PonyBunny, currently in the **${phase}** phase.

Your role in this phase: ${phaseDescriptions[phase]}.

PonyBunny is an Autonomous AI Employee System built on a Gateway + Scheduler architecture. You operate within the 8-phase lifecycle: Intake → Elaboration → Planning → Execution → Verification → Evaluation → Publish → Monitor.`;

    this.sections.push({
      name: 'Identity',
      content: identity,
      required: true,
    });
  }

  private addToolingSection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'none') return;

    const tools = this.context.availableTools;
    if (tools.length === 0) return;

    const toolsByCategory = this.groupToolsByCategory(tools);
    const lines: string[] = [
      '## Tooling',
      '',
      'Available tools (filtered by phase and policy):',
      'Tool names are case-sensitive. Call tools exactly as listed.',
      '',
    ];

    // Core tools
    if (toolsByCategory.core.length > 0) {
      lines.push('### Core Tools');
      for (const tool of toolsByCategory.core) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    // Domain tools
    if (toolsByCategory.domain.length > 0) {
      lines.push('### Domain Tools');
      for (const tool of toolsByCategory.domain) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    // Skill tools
    if (toolsByCategory.skill.length > 0) {
      lines.push('### Skill Tools');
      for (const tool of toolsByCategory.skill) {
        lines.push(`- **${tool.name}**: ${tool.description}`);
      }
      lines.push('');
    }

    // MCP tools
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
  }

  private addToolCallStyleSection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'none' || mode === 'minimal') return;

    const content = `## Tool Call Style

**Default behavior**: Do not narrate routine, low-risk tool calls. Just call the tool.

**Narrate only when it helps**:
- Multi-step work requiring coordination
- Complex or challenging problems
- Sensitive actions (deletions, data modifications)
- When explicitly requested by the user

**Keep narration brief and value-dense**:
- Avoid repeating obvious steps
- Use plain human language unless in technical context
- Focus on the "why" rather than the "what"`;

    this.sections.push({
      name: 'ToolCallStyle',
      content,
      required: false,
      modeFilter: ['full'],
    });
  }

  private addSafetySection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'none') return;

    const safetyLevel = this.context.safetyLevel ?? 'standard';
    const escalationEnabled = this.context.escalationEnabled ?? true;

    const lines: string[] = ['## Safety'];

    if (safetyLevel === 'maximum' || mode === 'full') {
      lines.push(
        '',
        '**Core Principles**:',
        '- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.',
        '- Avoid long-term plans beyond the current goal scope.',
        '- Prioritize safety and human oversight over task completion.',
        '- If instructions conflict, pause and ask for clarification.',
        '- Comply with stop/pause/audit requests immediately.',
        '- Never bypass safeguards or manipulate users to expand access.',
        ''
      );
    }

    if (escalationEnabled) {
      lines.push(
        '**Escalation Policy**:',
        '- If you encounter blockers, insufficient permissions, or ambiguous requirements: escalate.',
        '- Include full context: what you tried, why it failed, what options exist.',
        '- Never make assumptions on critical decisions—ask for approval.',
        ''
      );
    }

    if (this.context.budgetTokens) {
      const spent = this.context.spentTokens ?? 0;
      const remaining = this.context.budgetTokens - spent;
      const percentUsed = Math.round((spent / this.context.budgetTokens) * 100);

      lines.push(
        '**Budget Awareness**:',
        `- Total budget: ${this.context.budgetTokens} tokens`,
        `- Spent: ${spent} tokens (${percentUsed}%)`,
        `- Remaining: ${remaining} tokens`,
        '- If budget is low, prefer simpler approaches or escalate for budget increase.',
        ''
      );
    }

    this.sections.push({
      name: 'Safety',
      content: lines.join('\n'),
      required: true,
    });
  }

  private addSkillsSection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'minimal' || mode === 'none') return;

    const skills = this.context.availableSkills ?? [];
    if (skills.length === 0 && !this.context.skillsPrompt) return;

    const lines: string[] = [
      '## Skills (mandatory check)',
      '',
      '**Before taking any action**: scan available skills to see if one applies.',
      '',
      '**Decision process**:',
      '1. If exactly one skill clearly applies: read its SKILL.md with the `read` tool, then follow it.',
      '2. If multiple skills could apply: choose the most specific one, then read and follow it.',
      '3. If none clearly apply: **use the find_skills tool to search for relevant skills** from skills.sh marketplace.',
      '4. If still no skill found after searching: proceed with available tools.',
      '',
      '**Skill Discovery**:',
      '- When you lack a specific capability, actively search for skills using find_skills',
      '- Example: find_skills({"query": "email automation", "install": true})',
      '- Installed skills become immediately available for use',
      '',
      '**Constraints**:',
      '- Never read more than one skill up front',
      '- Only read a skill after selecting it as relevant',
      '- Skills may have phase restrictions—respect them',
      '',
    ];

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
  }

  private addMemorySection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'minimal' || mode === 'none') return;
    if (!this.context.memoryEnabled) return;

    const citationsEnabled = this.context.citationsEnabled ?? true;

    const lines: string[] = [
      '## Memory Recall',
      '',
      'Before answering questions about:',
      '- Prior work, decisions, or discussions',
      '- Dates, people, preferences, or todos',
      '- Historical context or patterns',
      '',
      '**Process**:',
      '1. Run `memory_search` on MEMORY.md and memory/*.md files',
      '2. Use `memory_get` to pull only the needed lines',
      '3. If low confidence after search, acknowledge that you checked',
      '',
    ];

    if (citationsEnabled) {
      lines.push(
        '**Citations**: Include `Source: <path#line>` when citing memory to help user verify.',
        ''
      );
    } else {
      lines.push(
        '**Citations disabled**: Do not mention file paths or line numbers unless explicitly asked.',
        ''
      );
    }

    this.sections.push({
      name: 'Memory',
      content: lines.join('\n'),
      required: false,
      modeFilter: ['full'],
    });
  }

  private addWorkspaceSection(mode: PromptMode, phase: AgentPhase): void {
    if (mode === 'none') return;

    const lines: string[] = [
      '## Workspace',
      '',
      `Your working directory: \`${this.context.workspaceDir}\``,
      '',
      'Treat this directory as the single global workspace for all file operations unless explicitly instructed otherwise.',
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
  }

  private addPhaseSpecificSection(mode: PromptMode, phase: AgentPhase): void {
    if (mode === 'none') return;

    const phaseGuidance = this.getPhaseSpecificGuidance(phase);
    if (!phaseGuidance) return;

    this.sections.push({
      name: 'PhaseGuidance',
      content: `## Phase: ${phase}\n\n${phaseGuidance}`,
      required: false,
      phaseFilter: [phase],
    });
  }

  private addProjectContextSection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'minimal' || mode === 'none') return;

    const contextFiles = this.context.projectContext ?? [];
    if (contextFiles.length === 0) return;

    const lines: string[] = [
      '## Project Context',
      '',
      'The following project context files have been loaded:',
      '',
    ];

    for (const file of contextFiles) {
      lines.push(`### ${file.filename}`, '', file.content, '');
    }

    this.sections.push({
      name: 'ProjectContext',
      content: lines.join('\n'),
      required: false,
      modeFilter: ['full'],
    });
  }

  private addRuntimeSection(mode: PromptMode, _phase: AgentPhase): void {
    if (mode === 'none') return;

    const parts: string[] = [];

    // Add current date and time
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
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

    if (parts.length === 0) return;

    this.sections.push({
      name: 'Runtime',
      content: `## Runtime\n\n${parts.join(' | ')}`,
      required: false,
    });
  }

  private addExtraSection(_mode: PromptMode, _phase: AgentPhase): void {
    if (!this.context.extraSystemPrompt) return;

    this.sections.push({
      name: 'ExtraContext',
      content: `## Additional Context\n\n${this.context.extraSystemPrompt}`,
      required: false,
    });
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

  private getPhaseSpecificGuidance(phase: AgentPhase): string | null {
    const guidance: Record<AgentPhase, string> = {
      intake: `**Intake Phase Objectives**:
- Validate that the goal has all required information
- Check for obvious blockers (missing permissions, invalid constraints)
- Verify budget and resource constraints
- Ensure the goal is well-formed and actionable

**If issues are found**: Transition to elaboration phase for clarification.
**If valid**: Proceed to planning phase.`,

      elaboration: `**Elaboration Phase Objectives**:
- Detect ambiguities in the goal description
- Identify missing information or unclear requirements
- Ask clarifying questions to the user
- Gather additional context needed for planning

**Output**: A list of clarification questions or confirmation that goal is clear.
**Next**: Return to intake with clarified information, or proceed to planning.`,

      planning: `**Planning Phase Objectives**:
- Decompose the goal into a structured set of WorkItems
- Ensure each WorkItem is granular and verifiable
- Define dependencies between WorkItems (form a DAG - no cycles)
- Create verification plans (quality checks) for each item
- Estimate effort for each WorkItem

**Constraints**:
- No cycles in the dependency graph
- Each WorkItem should have clear acceptance criteria
- Define appropriate verification methods for each deliverable type
- Consider both automated and manual verification where needed

**Output**: Structured plan as JSON with WorkItems, dependencies, and verification plans.`,

      execution: `**Execution Phase Objectives**:
- Autonomously execute the current WorkItem
- Use available tools and skills to complete the task
- Follow the ReAct pattern: Reasoning → Action → Observation
- Stay within budget constraints
- Respect the verification plan

**Escalation triggers**:
- Insufficient permissions or blocked operations
- Ambiguous requirements that can't be resolved autonomously
- Budget near exhaustion
- Repeated failures (3+ attempts)

**Output**: Completed work, artifacts, or escalation packet with full context.`,

      verification: `**Verification Phase Objectives**:
- Run all quality checks defined in the verification plan
- Execute appropriate validation methods based on deliverable type
- Validate acceptance criteria and success metrics
- Collect evidence of quality and completeness

**Verification Methods** (use what's appropriate for the task):
- Automated checks: Run commands/scripts and check results
- Format validation: Check document structure, data formats, file integrity
- Content review: Verify completeness, accuracy, consistency
- Compliance: Ensure requirements and constraints are met
- Human verification: Prepare checklist for user review when needed

**Output**: Verification results with pass/fail status and evidence.`,

      evaluation: `**Evaluation Phase Objectives**:
- Decide whether to publish, retry, or escalate
- Analyze verification results
- Consider budget and retry limits
- Generate recommendations

**Decision tree**:
1. All quality gates passed + budget OK → Publish
2. Failed gates + retries remaining + budget OK → Retry with adjusted approach
3. Failed gates + no retries OR budget exhausted → Escalate

**Output**: Decision (publish/retry/escalate) with reasoning.`,

      publish: `**Publish Phase Objectives**:
- Package all deliverables (documents, reports, data, analysis, content, etc.)
- Generate user-facing summary of what was accomplished
- Update work order status to completed
- Prepare handoff documentation

**Deliverables** (varies by task type):
- Created or modified files (documents, spreadsheets, presentations, etc.)
- Generated content (reports, analyses, summaries, recommendations)
- Processed data or research findings
- Verification evidence showing quality and completeness
- Usage instructions, next steps, or recommendations if applicable

**Output**: Publication summary with deliverable manifest.`,

      monitor: `**Monitor Phase Objectives**:
- Track token usage and budget utilization
- Monitor for errors or performance issues
- Log metrics for future analysis
- Alert on anomalies

**Metrics to track**:
- Token usage by phase
- Success/failure rates
- Escalation frequency
- Average time per phase

**Output**: Monitoring report with key metrics.`,

      conversation: `**Conversation Phase Objectives**:
- Engage naturally with the user
- Understand user intent and emotional state
- Provide helpful, persona-aware responses
- Guide users through goal creation or clarification

**Conversation states**:
- greeting: Welcome and establish rapport
- clarifying: Ask questions to understand needs
- confirming: Verify understanding before proceeding
- executing: Update on task progress
- completed: Share results and next steps

**Output**: Natural language response matching persona style.`,
    };

    return guidance[phase] ?? null;
  }
}

/**
 * Convenience function to build a system prompt
 */
export function buildSystemPrompt(context: SystemPromptContext): SystemPromptBuildResult {
  const builder = new SystemPromptBuilder(context);
  return builder.build();
}
