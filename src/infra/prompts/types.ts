/**
 * System Prompt Types
 * Defines types for building modular, phase-aware system prompts
 */

export type PromptMode = 'full' | 'minimal' | 'none';

export type AgentPhase =
  | 'intake'
  | 'elaboration'
  | 'planning'
  | 'execution'
  | 'verification'
  | 'evaluation'
  | 'publish'
  | 'monitor'
  | 'conversation';

export interface ToolSummary {
  name: string;
  description: string;
  category?: 'core' | 'skill' | 'mcp' | 'domain';
}

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  eligibility?: {
    phase?: AgentPhase[];
    requiresApproval?: boolean;
  };
}

export interface RouteContextSummary {
  source: string;
  providerId?: string;
  channel?: string;
  agentId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
  isSubagent?: boolean;
}

export interface ToolPolicyAuditSummary {
  hasLayeredPolicy: boolean;
  baselineAllowedTools: string[];
  effectiveAllowedTools: string[];
  deniedTools: Array<{ tool: string; reason: string }>;
  appliedLayers: string[];
}

export interface SystemPromptContext {
  // Agent context
  agentPhase: AgentPhase;
  promptMode?: PromptMode;

  // Work context
  workspaceDir: string;
  goalId?: string;
  goalTitle?: string;
  goalDescription?: string;
  budgetTokens?: number;
  spentTokens?: number;

  // Tool context
  availableTools: ToolSummary[];
  toolPolicy?: {
    allow?: string[];
    deny?: string[];
    requireApproval?: string[];
  };
  toolPolicyAudit?: ToolPolicyAuditSummary;
  routeContext?: RouteContextSummary;

  // Skill context
  availableSkills?: SkillInfo[];
  skillsPrompt?: string;

  // MCP context
  mcpServers?: Array<{
    name: string;
    description?: string;
    tools: string[];
  }>;

  // Model context
  modelName?: string;
  modelCapabilities?: {
    reasoning?: boolean;
    vision?: boolean;
    toolUse?: boolean;
  };

  // Project context
  projectContext?: Array<{
    filename: string;
    content: string;
  }>;

  // Memory context
  memoryEnabled?: boolean;
  citationsEnabled?: boolean;

  // Runtime context
  runtimeInfo?: {
    platform?: string;
    nodeVersion?: string;
    cwd?: string;
  };

  // Safety context
  safetyLevel?: 'standard' | 'elevated' | 'maximum';
  escalationEnabled?: boolean;

  // Custom sections
  extraSystemPrompt?: string;
}

export interface SystemPromptSection {
  name: string;
  content: string;
  required: boolean;
  phaseFilter?: AgentPhase[];
  modeFilter?: PromptMode[];
}

export interface SystemPromptBuildResult {
  prompt: string;
  sections: SystemPromptSection[];
  metadata: {
    phase: AgentPhase;
    mode: PromptMode;
    toolCount: number;
    skillCount: number;
    sectionCount: number;
  };
}
