/**
 * Prompt Provider
 * Central service for generating system prompts for different agent phases
 */

import type { Goal, WorkItem } from '../../work-order/types/index.js';
import type { AgentPhase, SystemPromptContext } from '../prompts/types.js';
import { buildSystemPrompt } from '../prompts/system-prompt-builder.js';
import { getGlobalSkillRegistry } from '../skills/skill-registry.js';
import { getGlobalToolProvider } from '../tools/tool-provider.js';

export interface PromptOptions {
  phase: AgentPhase;
  workspaceDir: string;
  goal?: Goal;
  workItem?: WorkItem;
  budgetTokens?: number;
  spentTokens?: number;
  modelName?: string;
  extraSystemPrompt?: string;
  promptMode?: 'full' | 'minimal' | 'none';
}

export class PromptProvider {
  constructor(
    private skillRegistry = getGlobalSkillRegistry(),
    private toolProvider = getGlobalToolProvider()
  ) {}

  /**
   * Generate system prompt for a given phase
   */
  generatePrompt(options: PromptOptions): string {
    const context = this.buildContext(options);
    const result = buildSystemPrompt(context);
    return result.prompt;
  }

  /**
   * Generate prompt with metadata
   */
  generatePromptWithMetadata(options: PromptOptions) {
    const context = this.buildContext(options);
    return buildSystemPrompt(context);
  }

  private buildContext(options: PromptOptions): SystemPromptContext {
    // Get available tools for this phase
    const availableTools = this.toolProvider.getToolsForPhase(options.phase);

    // Get available skills for this phase
    const availableSkills = this.skillRegistry.getSkillsForPhase(options.phase).map(skill => ({
      name: skill.name,
      description: skill.description,
      location: skill.filePath,
      eligibility: {
        phase: skill.metadata.phases as AgentPhase[] | undefined,
        requiresApproval: skill.metadata.requiresApproval,
      },
    }));

    // Generate skills prompt
    const skillsPrompt = this.skillRegistry.generateSkillsPrompt({
      phase: options.phase,
      format: { format: 'xml' },
    });

    const context: SystemPromptContext = {
      agentPhase: options.phase,
      promptMode: options.promptMode ?? 'full',
      workspaceDir: options.workspaceDir,
      availableTools,
      availableSkills,
      skillsPrompt: skillsPrompt || undefined,
      modelName: options.modelName,
      extraSystemPrompt: options.extraSystemPrompt,
      safetyLevel: 'standard',
      escalationEnabled: true,
      runtimeInfo: {
        platform: process.platform,
        nodeVersion: process.version,
        cwd: process.cwd(),
      },
    };

    // Add goal context if available
    if (options.goal) {
      context.goalId = options.goal.id;
      context.goalTitle = options.goal.title;
      context.goalDescription = options.goal.description;
      context.budgetTokens = options.budgetTokens ?? options.goal.budget_tokens;
      context.spentTokens = options.spentTokens ?? 0;
    }

    return context;
  }

  /**
   * Generate prompt for intake phase
   */
  generateIntakePrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'intake' });
  }

  /**
   * Generate prompt for elaboration phase
   */
  generateElaborationPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'elaboration' });
  }

  /**
   * Generate prompt for planning phase
   */
  generatePlanningPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'planning' });
  }

  /**
   * Generate prompt for execution phase
   */
  generateExecutionPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'execution' });
  }

  /**
   * Generate prompt for verification phase
   */
  generateVerificationPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'verification' });
  }

  /**
   * Generate prompt for evaluation phase
   */
  generateEvaluationPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'evaluation' });
  }

  /**
   * Generate prompt for publish phase
   */
  generatePublishPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'publish' });
  }

  /**
   * Generate prompt for monitor phase
   */
  generateMonitorPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'monitor' });
  }

  /**
   * Generate prompt for conversation
   */
  generateConversationPrompt(options: Omit<PromptOptions, 'phase'>): string {
    return this.generatePrompt({ ...options, phase: 'conversation' });
  }
}

// Singleton instance
let globalPromptProvider: PromptProvider | null = null;

export function getGlobalPromptProvider(): PromptProvider {
  if (!globalPromptProvider) {
    globalPromptProvider = new PromptProvider();
  }
  return globalPromptProvider;
}
