/**
 * Skill Types
 * Defines types for the skill system
 */

export type SkillSource = 'workspace' | 'managed' | 'bundled' | 'extra';

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];

  // Eligibility
  phases?: string[]; // Which agent phases can use this skill
  requiresApproval?: boolean;
  primaryEnv?: 'host' | 'sandbox';

  // Invocation
  userInvocable?: boolean; // Can users invoke via CLI commands?
  disableModelInvocation?: boolean; // Exclude from model prompt?

  // Command dispatch
  commandDispatch?: 'tool' | 'skill';
  commandTool?: string; // Tool name for direct dispatch
  commandArgMode?: 'raw' | 'parsed';
}

export interface Skill {
  name: string;
  description: string;
  filePath: string; // Path to SKILL.md
  baseDir: string; // Directory containing the skill
  source: SkillSource;
  metadata: SkillMetadata;
  content?: string; // Lazy-loaded SKILL.md content
}

export interface SkillLoadOptions {
  workspaceDir: string;
  managedSkillsDir?: string; // Default: ~/.ponybunny/skills
  bundledSkillsDir?: string; // Default: <package>/skills
  extraDirs?: string[]; // Additional skill directories

  // Filters
  skillFilter?: string[]; // Only load specific skills
  phaseFilter?: string[]; // Only load skills for specific phases
}

export interface SkillPromptFormat {
  format: 'xml' | 'markdown';
  includeContent?: boolean; // Include full SKILL.md or just metadata?
}

export interface ISkillRegistry {
  /**
   * Load skills from all configured directories
   */
  loadSkills(options: SkillLoadOptions): Promise<void>;

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[];

  /**
   * Get skills filtered by phase
   */
  getSkillsForPhase(phase: string): Skill[];

  /**
   * Get a specific skill by name
   */
  getSkill(name: string): Skill | undefined;

  /**
   * Check if a skill exists
   */
  hasSkill(name: string): boolean;

  /**
   * Generate skill prompt for LLM
   */
  generateSkillsPrompt(options?: {
    phase?: string;
    format?: SkillPromptFormat;
  }): string;

  /**
   * Load skill content (lazy load SKILL.md)
   */
  loadSkillContent(skillName: string): Promise<string>;
}
