/**
 * Types for PonyBunny Web UI
 * Re-exported from main project types for browser compatibility
 */

// ============================================================================
// Goal & WorkItem Status Types
// ============================================================================

export type GoalStatus = 'queued' | 'active' | 'blocked' | 'completed' | 'cancelled';

export type WorkItemStatus =
  | 'queued'
  | 'ready'
  | 'in_progress'
  | 'verify'
  | 'done'
  | 'failed'
  | 'blocked';

export type WorkItemType =
  | 'code'
  | 'test'
  | 'doc'
  | 'refactor'
  | 'analysis';

export type EffortEstimate = 'S' | 'M' | 'L' | 'XL';

export type VerificationStatus = 'not_started' | 'passed' | 'failed' | 'skipped';

export type RunStatus =
  | 'running'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'aborted';

export type ArtifactType =
  | 'patch'
  | 'test_result'
  | 'log'
  | 'report'
  | 'binary';

export type EscalationType =
  | 'stuck'
  | 'ambiguous'
  | 'risk'
  | 'credential'
  | 'validation_failed';

export type EscalationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type EscalationStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'dismissed';

export type ResolutionAction =
  | 'user_input'
  | 'skip'
  | 'retry'
  | 'alternative_approach';

// ============================================================================
// Core Domain Types
// ============================================================================

export interface SuccessCriterion {
  description: string;
  type: 'deterministic' | 'heuristic';
  verification_method: string;
  required: boolean;
}

export interface Goal {
  id: string;
  created_at: number;
  updated_at: number;

  title: string;
  description: string;
  success_criteria: SuccessCriterion[];

  status: GoalStatus;
  priority: number;

  allowed_actions?: string[];

  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
  spent_tokens: number;
  spent_time_minutes: number;
  spent_cost_usd: number;

  parent_goal_id?: string;

  tags?: string[];
  context?: Record<string, unknown>;
}

export interface QualityGate {
  name: string;
  type: 'deterministic' | 'llm_review';
  command?: string;
  expected_exit_code?: number;
  review_prompt?: string;
  required: boolean;
}

export interface VerificationPlan {
  quality_gates: QualityGate[];
  acceptance_criteria: string[];
}

export interface WorkItem {
  id: string;
  created_at: number;
  updated_at: number;

  goal_id: string;
  title: string;
  description: string;
  item_type: WorkItemType;

  status: WorkItemStatus;
  priority: number;

  dependencies: string[];
  blocks: string[];

  assigned_agent?: string;
  estimated_effort: EffortEstimate;
  retry_count: number;
  max_retries: number;

  verification_plan?: VerificationPlan;
  verification_status: VerificationStatus;

  context?: Record<string, unknown>;
}

export interface Run {
  id: string;
  created_at: number;
  completed_at?: number;

  work_item_id: string;
  goal_id: string;

  agent_type: string;
  run_sequence: number;

  status: RunStatus;
  exit_code?: number;
  error_message?: string;
  error_signature?: string;

  tokens_used: number;
  time_seconds?: number;
  cost_usd: number;

  artifacts: string[];
  execution_log?: string;

  context?: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  created_at: number;

  run_id: string;
  work_item_id: string;
  goal_id: string;

  artifact_type: ArtifactType;
  file_path?: string;
  content_hash: string;
  size_bytes: number;

  storage_type: 'inline' | 'file' | 'blob';
  content?: string;
  blob_path?: string;

  metadata?: Record<string, unknown>;
}

export interface EscalationContext {
  error_signature?: string;
  retry_count?: number;
  last_error?: string;
  attempted_solutions?: string[];
  required_input?: string[];
  risk_assessment?: {
    impact: 'low' | 'medium' | 'high' | 'critical';
    affected_systems: string[];
    reversible: boolean;
  };
}

export interface Escalation {
  id: string;
  created_at: number;
  resolved_at?: number;

  work_item_id: string;
  goal_id: string;
  run_id?: string;

  escalation_type: EscalationType;
  severity: EscalationSeverity;
  status: EscalationStatus;

  title: string;
  description: string;
  context_data?: EscalationContext;

  resolution_action?: ResolutionAction;
  resolution_data?: Record<string, unknown>;
  resolver?: string;
}

// ============================================================================
// Gateway Communication Types
// ============================================================================

export type Permission = 'read' | 'write' | 'admin';

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface EventFrame {
  type: 'event';
  event: string;
  data: unknown;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

export type GatewayEventType =
  | 'goal.created'
  | 'goal.updated'
  | 'goal.completed'
  | 'goal.cancelled'
  | 'workitem.created'
  | 'workitem.updated'
  | 'workitem.completed'
  | 'workitem.failed'
  | 'run.started'
  | 'run.completed'
  | 'escalation.created'
  | 'escalation.resolved'
  | 'connection.authenticated'
  | 'connection.disconnected'
  // Conversation events
  | 'conversation.response'
  | 'conversation.typing'
  | 'conversation.ended'
  | 'task.narration'
  | 'task.result';

export interface GatewayEvent<T = unknown> {
  type: GatewayEventType;
  timestamp: number;
  data: T;
}

// ============================================================================
// UI-Specific Types
// ============================================================================

export type ViewMode = 'standard' | 'expert';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  goalId?: string;
  status?: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface GoalSubmitParams {
  title: string;
  description?: string;
  success_criteria?: SuccessCriterion[];
  priority?: number;
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
  tags?: string[];
  context?: Record<string, unknown>;
}

// ============================================================================
// Conversation Types
// ============================================================================

export type ConversationState =
  | 'idle'
  | 'chatting'
  | 'clarifying'
  | 'executing'
  | 'monitoring'
  | 'reporting'
  | 'retrying';

export interface PersonalityTraits {
  warmth: number;
  formality: number;
  humor: number;
  empathy: number;
}

export interface CommunicationStyle {
  verbosity: 'concise' | 'balanced' | 'detailed';
  technicalDepth: 'simplified' | 'adaptive' | 'expert';
  expressiveness: 'minimal' | 'moderate' | 'expressive';
}

export interface Persona {
  id: string;
  name: string;
  nickname?: string;
  personality: PersonalityTraits;
  communicationStyle: CommunicationStyle;
  expertise: {
    primaryDomains: string[];
    skillConfidence: Record<string, number>;
  };
  backstory?: string;
  locale: string;
}

export interface PersonaSummary {
  id: string;
  name: string;
  nickname?: string;
  locale: string;
}

export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: Array<{
    type: 'image' | 'file' | 'audio';
    url?: string;
    mimeType: string;
    filename?: string;
  }>;
}

export interface ConversationSession {
  id: string;
  personaId: string;
  state: ConversationState;
  turns: ConversationTurn[];
  activeGoalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessageParams {
  sessionId?: string;
  personaId?: string;
  message: string;
  attachments?: Array<{
    type: 'image' | 'file' | 'audio';
    base64?: string;
    mimeType: string;
    filename?: string;
  }>;
}

export interface ConversationMessageResult {
  sessionId: string;
  response: string;
  state: ConversationState;
  taskInfo?: {
    goalId: string;
    status: string;
    progress?: number;
  };
}
