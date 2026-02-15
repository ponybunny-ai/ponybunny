import type { AgentAConfig } from './types.js';

export const DEFAULT_AGENT_A_CONFIG: AgentAConfig = {
  rate_limits: {
    reddit: {
      max_requests_per_minute: 30,
      backoff_on_429_seconds: [60, 120, 300],
    },
    github: {
      max_requests_per_minute: 60,
      backoff_on_403_seconds: [60, 120, 300],
    },
    forum_web: {
      max_requests_per_minute: 10,
      backoff_on_403_429_seconds: [120, 300, 900],
    },
  },
  limits: {
    raw_text_max_chars: 12000,
    problem_raw_text_max_chars: 2000,
    surrounding_context_max_chars: 2000,
    signal_markers_max_items: 5,
  },
  circuit_breaker_failure_threshold: 5,
  circuit_breaker_backoff_hours: 6,
};
