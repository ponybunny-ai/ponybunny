/**
 * Structured LLM error types.
 *
 * Protocol adapters convert provider-specific errors into LLMErrorCode,
 * giving RetryHandler (and any other consumer) a reliable, machine-readable
 * signal instead of fragile string pattern matching.
 */

export type LLMErrorCode =
  | 'rate_limited'        // 429 — retry with same model after delay
  | 'context_exceeded'    // context window too small — switch_model
  | 'auth_failed'         // 401/403 — non-recoverable
  | 'content_policy'      // safety filter — non-recoverable
  | 'quota_exceeded'      // billing/quota — non-recoverable
  | 'server_error'        // 5xx — retry with same model
  | 'timeout'             // request timeout — retry
  | 'network_error'       // ECONNRESET, ETIMEDOUT — retry
  | 'model_unavailable'   // model not found/disabled — switch_model
  | 'unknown';            // unclassified

/**
 * Maps LLMErrorCode to default retry behaviour.
 * RetryHandler can use this instead of string matching.
 */
export const LLM_ERROR_DEFAULTS: Record<LLMErrorCode, {
  recoverable: boolean;
  strategy: 'same_model' | 'switch_model' | 'escalate';
}> = {
  rate_limited:     { recoverable: true,  strategy: 'same_model' },
  context_exceeded: { recoverable: true,  strategy: 'switch_model' },
  auth_failed:      { recoverable: false, strategy: 'escalate' },
  content_policy:   { recoverable: false, strategy: 'escalate' },
  quota_exceeded:   { recoverable: false, strategy: 'escalate' },
  server_error:     { recoverable: true,  strategy: 'same_model' },
  timeout:          { recoverable: true,  strategy: 'same_model' },
  network_error:    { recoverable: true,  strategy: 'same_model' },
  model_unavailable:{ recoverable: true,  strategy: 'switch_model' },
  unknown:          { recoverable: true,  strategy: 'same_model' },
};

/**
 * Classify an HTTP status code into an LLMErrorCode.
 * Protocol adapters can override this with more specific classification
 * based on response body content.
 */
export function classifyHttpStatus(status: number): LLMErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'model_unavailable';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Classify a network/runtime error into an LLMErrorCode.
 */
export function classifyNetworkError(error: unknown): LLMErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('econnreset') || lower.includes('econnrefused') || lower.includes('enotfound')) {
    return 'network_error';
  }
  if (lower.includes('etimedout') || lower.includes('timeout') || lower.includes('aborted')) {
    return 'timeout';
  }
  return 'unknown';
}
