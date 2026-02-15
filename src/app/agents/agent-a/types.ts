export type AgentAPlatform = 'reddit' | 'github' | 'forum_web';

export interface AgentATickInput {
  run_id: string;
  now: string;
  max_sources_per_tick: number;
  max_items_per_source: number;
  default_time_window: string;
}

export interface AgentATickResult {
  run_id: string;
  sources_processed: number;
  items_fetched: number;
  items_scanned: number;
  items_stored: number;
  errors: number;
  duration_ms: number;
}

export interface AgentASourceConfig {
  id: number;
  platform: AgentAPlatform;
  source_id: string;
  enabled: boolean;
  poll_interval_seconds: number;
  max_items: number;
  priority: number;
}

export interface AgentACheckpoint {
  platform: AgentAPlatform;
  source_id: string;
  cursor: string | null;
  last_seen_at: string | null;
  backoff_until: string | null;
  failure_count: number;
  updated_at: string;
}

export interface AgentARawItem {
  platform: AgentAPlatform;
  source_id: string;
  permalink: string;
  author: string | null;
  created_at: string | null;
  raw_text: string;
  raw_html: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentASourceReadRequest {
  platform: AgentAPlatform;
  source_id: string;
  cursor: string | null;
  time_window: string;
  max_items: number;
}

export interface AgentASourceReadResult {
  items: AgentARawItem[];
  next_cursor: string | null;
  backoff_seconds?: number;
  error?: string;
}

export interface AgentADetectRequest {
  raw_text: string;
  platform: AgentAPlatform;
}

export type AgentADetectLabel =
  | 'problem'
  | 'how_to'
  | 'bug'
  | 'request'
  | 'complaint'
  | 'discussion'
  | 'showcase'
  | 'other';

export interface AgentADetectResult {
  has_problem_signal: boolean;
  signal_markers: string[];
  label: AgentADetectLabel;
  confidence: number;
}

export interface AgentAExtractRequest {
  raw_text: string;
  window_chars: number;
  platform: AgentAPlatform;
}

export interface AgentAExtractResult {
  problem_raw_text: string;
  surrounding_context: string;
  mentioned_tools: string[];
  constraints: string[];
  extraction_fallback?: boolean;
}

export type AgentARoleGuess =
  | 'founder'
  | 'employee'
  | 'developer'
  | 'ops'
  | 'student'
  | 'hobbyist'
  | 'unknown';

export interface AgentARoleResult {
  role_guess: AgentARoleGuess;
  confidence: number;
}

export interface AgentAStoreRequest {
  platform: AgentAPlatform;
  source_id: string;
  permalink: string;
  author: string | null;
  created_at: string | null;
  problem_raw_text: string;
  surrounding_context: string;
  label: string;
  signal_markers: string[];
  role_guess: string;
  role_confidence: number;
  raw_text_hash: string;
  ingest_run_id: string;
}

export interface AgentAStoreResult {
  stored: boolean;
  record_id: string | null;
  deduped: boolean;
}

export interface AgentARateLimitConfig {
  max_requests_per_minute: number;
  backoff_on_429_seconds?: number[];
  backoff_on_403_seconds?: number[];
  backoff_on_403_429_seconds?: number[];
}

export interface AgentALimitsConfig {
  raw_text_max_chars: number;
  problem_raw_text_max_chars: number;
  surrounding_context_max_chars: number;
  signal_markers_max_items: number;
}

export interface AgentAConfig {
  rate_limits: Record<AgentAPlatform, AgentARateLimitConfig>;
  limits: AgentALimitsConfig;
  circuit_breaker_failure_threshold: number;
  circuit_breaker_backoff_hours: number;
}
