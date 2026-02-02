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

export type StorageType = 
  | 'inline'       
  | 'file'         
  | 'blob';        

export type DecisionType = 
  | 'approach'     
  | 'tool'         
  | 'model'        
  | 'retry'        
  | 'escalate';    

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

export type ContextPackType = 
  | 'daily_checkpoint'   
  | 'error_recovery'     
  | 'handoff';           

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
  context?: Record<string, any>;
}

export interface SuccessCriterion {
  description: string;
  type: 'deterministic' | 'heuristic';
  verification_method: string; // e.g., "npm test", "lint check", "human review"
  required: boolean;
}

/**
 * WorkItem - Granular executable task
 */
export interface WorkItem {
  id: string;
  created_at: number;
  updated_at: number;
  
  // Core
  goal_id: string;
  title: string;
  description: string;
  item_type: WorkItemType;
  
  // State
  status: WorkItemStatus;
  priority: number;
  
  // Dependencies (DAG)
  dependencies: string[]; // Work item IDs
  blocks: string[];       // Work item IDs
  
  // Execution
  assigned_agent?: string;
  estimated_effort: EffortEstimate;
  retry_count: number;
  max_retries: number;
  
  // Verification
  verification_plan?: VerificationPlan;
  verification_status: VerificationStatus;
  
  // Context
  context?: Record<string, any>;
}

export interface VerificationPlan {
  quality_gates: QualityGate[];
  acceptance_criteria: string[];
}

export interface QualityGate {
  name: string;
  type: 'deterministic' | 'llm_review';
  command?: string;           // For deterministic gates (e.g., "npm test")
  expected_exit_code?: number;
  review_prompt?: string;     // For LLM review gates
  required: boolean;
}

/**
 * Run - Execution record for a work item
 */
export interface Run {
  id: string;
  created_at: number;
  completed_at?: number;
  
  // Relationships
  work_item_id: string;
  goal_id: string;
  
  // Execution
  agent_type: string;
  run_sequence: number;
  
  // Outcome
  status: RunStatus;
  exit_code?: number;
  error_message?: string;
  error_signature?: string; // Hash for pattern detection
  
  // Resources
  tokens_used: number;
  time_seconds?: number;
  cost_usd: number;
  
  // Data
  artifacts: string[];      // Artifact IDs
  execution_log?: string;
  
  // Context
  context?: Record<string, any>;
}

/**
 * Artifact - Generated output (code patch, test result, etc.)
 */
export interface Artifact {
  id: string;
  created_at: number;
  
  // Relationships
  run_id: string;
  work_item_id: string;
  goal_id: string;
  
  // Details
  artifact_type: ArtifactType;
  file_path?: string;
  content_hash: string;
  size_bytes: number;
  
  // Storage
  storage_type: StorageType;
  content?: string;      // For inline storage
  blob_path?: string;    // For file/blob storage
  
  // Metadata
  metadata?: Record<string, any>;
}

/**
 * Decision - Agent reasoning log
 */
export interface Decision {
  id: string;
  created_at: number;
  
  // Relationships
  run_id: string;
  work_item_id: string;
  goal_id: string;
  
  // Decision
  decision_type: DecisionType;
  decision_point: string;
  options_considered: DecisionOption[];
  selected_option: string;
  reasoning: string;
  
  // Metadata
  confidence_score?: number; // 0.0-1.0
  metadata?: Record<string, any>;
}

export interface DecisionOption {
  label: string;
  description: string;
  pros?: string[];
  cons?: string[];
}

/**
 * Escalation - Human intervention request
 */
export interface Escalation {
  id: string;
  created_at: number;
  resolved_at?: number;
  
  // Relationships
  work_item_id: string;
  goal_id: string;
  run_id?: string;
  
  // Details
  escalation_type: EscalationType;
  severity: EscalationSeverity;
  status: EscalationStatus;
  
  // Context
  title: string;
  description: string;
  context_data?: EscalationContext;
  
  // Resolution
  resolution_action?: ResolutionAction;
  resolution_data?: Record<string, any>;
  resolver?: string;
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

/**
 * ContextPack - Structured state snapshot for multi-day persistence
 */
export interface ContextPack {
  id: string;
  created_at: number;
  
  // Relationships
  goal_id: string;
  
  // Details
  pack_type: ContextPackType;
  snapshot_data: ContextSnapshot;
  
  // Metadata
  compressed: boolean;
  size_bytes: number;
  metadata?: Record<string, any>;
}

export interface ContextSnapshot {
  goal_state: {
    current_work_items: string[];
    completed_work_items: string[];
    blocked_work_items: string[];
    recent_decisions: Decision[];
    active_escalations: Escalation[];
  };
  
  execution_summary: {
    total_runs: number;
    success_count: number;
    failure_count: number;
    most_common_errors: { signature: string; count: number }[];
  };
  
  knowledge_base: {
    learned_patterns: string[];
    pitfalls_discovered: string[];
    successful_approaches: string[];
  };
  
  next_actions: {
    recommended_work_items: string[];
    risk_factors: string[];
    required_human_input?: string[];
  };
}

/**
 * Meta - Database metadata
 */
export interface Meta {
  key: string;
  value: string;
  updated_at: number;
}

// ============================================================================
// Database Row Types (matching SQLite storage)
// ============================================================================

/**
 * Raw database row types (JSON fields are still strings)
 * Used for direct DB queries before parsing
 */
export interface GoalRow {
  id: string;
  created_at: number;
  updated_at: number;
  title: string;
  description: string;
  success_criteria: string; // JSON
  status: GoalStatus;
  priority: number;
  budget_tokens: number | null;
  budget_time_minutes: number | null;
  budget_cost_usd: number | null;
  spent_tokens: number;
  spent_time_minutes: number;
  spent_cost_usd: number;
  parent_goal_id: string | null;
  tags: string | null;       // JSON
  context: string | null;    // JSON
}

export interface WorkItemRow {
  id: string;
  created_at: number;
  updated_at: number;
  goal_id: string;
  title: string;
  description: string;
  item_type: WorkItemType;
  status: WorkItemStatus;
  priority: number;
  dependencies: string | null; // JSON
  blocks: string | null;       // JSON
  assigned_agent: string | null;
  estimated_effort: EffortEstimate;
  retry_count: number;
  max_retries: number;
  verification_plan: string | null;  // JSON
  verification_status: VerificationStatus;
  context: string | null;      // JSON
}

export interface RunRow {
  id: string;
  created_at: number;
  completed_at: number | null;
  work_item_id: string;
  goal_id: string;
  agent_type: string;
  run_sequence: number;
  status: RunStatus;
  exit_code: number | null;
  error_message: string | null;
  error_signature: string | null;
  tokens_used: number;
  time_seconds: number | null;
  cost_usd: number;
  artifacts: string | null;    // JSON
  execution_log: string | null;
  context: string | null;      // JSON
}

export interface ArtifactRow {
  id: string;
  created_at: number;
  run_id: string;
  work_item_id: string;
  goal_id: string;
  artifact_type: ArtifactType;
  file_path: string | null;
  content_hash: string;
  size_bytes: number;
  storage_type: StorageType;
  content: string | null;
  blob_path: string | null;
  metadata: string | null;     // JSON
}

export interface DecisionRow {
  id: string;
  created_at: number;
  run_id: string;
  work_item_id: string;
  goal_id: string;
  decision_type: DecisionType;
  decision_point: string;
  options_considered: string;  // JSON
  selected_option: string;
  reasoning: string;
  confidence_score: number | null;
  metadata: string | null;     // JSON
}

export interface EscalationRow {
  id: string;
  created_at: number;
  resolved_at: number | null;
  work_item_id: string;
  goal_id: string;
  run_id: string | null;
  escalation_type: EscalationType;
  severity: EscalationSeverity;
  status: EscalationStatus;
  title: string;
  description: string;
  context_data: string | null; // JSON
  resolution_action: ResolutionAction | null;
  resolution_data: string | null; // JSON
  resolver: string | null;
}

export interface ContextPackRow {
  id: string;
  created_at: number;
  goal_id: string;
  pack_type: ContextPackType;
  snapshot_data: string;       // JSON
  compressed: number;          // SQLite boolean (0/1)
  size_bytes: number;
  metadata: string | null;     // JSON
}

export interface MetaRow {
  key: string;
  value: string;
  updated_at: number;
}
