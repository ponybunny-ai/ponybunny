/**
 * Tool execution timeout configuration and utilities.
 *
 * ADR-002 Phase E2: Risk-level-based tool execution timeouts with AbortController.
 *
 * This is a standalone utility intended for later integration into the
 * tool execution pipeline. It does not modify any existing execution paths.
 */

export type ToolRiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical';

export interface ToolTimeoutConfig {
  /** Default timeout when risk level is unknown or not provided. */
  defaultTimeoutMs: number;
  /** Per-risk-level timeout overrides. */
  riskLevelTimeouts: Record<ToolRiskLevel, number>;
}

export const DEFAULT_TOOL_TIMEOUT_CONFIG: ToolTimeoutConfig = {
  defaultTimeoutMs: 30_000,
  riskLevelTimeouts: {
    safe: 10_000,
    moderate: 30_000,
    dangerous: 60_000,
    critical: 15_000,
  },
};

/**
 * Resolve the timeout duration for a given risk level.
 * Falls back to the config's defaultTimeoutMs when riskLevel is undefined
 * or not present in the config.
 */
export function getTimeoutForRisk(
  riskLevel: ToolRiskLevel | undefined,
  config: ToolTimeoutConfig = DEFAULT_TOOL_TIMEOUT_CONFIG,
): number {
  if (riskLevel && riskLevel in config.riskLevelTimeouts) {
    return config.riskLevelTimeouts[riskLevel];
  }
  return config.defaultTimeoutMs;
}

export type ToolTimeoutResult<T> =
  | { result: T; timedOut: false }
  | { result: undefined; timedOut: true };

/**
 * Execute a function with a timeout. Returns the result or a timedOut indicator.
 * Uses AbortController so the provided function can check signal.aborted
 * and cooperatively cancel work.
 *
 * - On success: returns { result, timedOut: false }
 * - On timeout (abort): returns { result: undefined, timedOut: true }
 * - On other errors: re-throws
 */
export async function withToolTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<ToolTimeoutResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fn(controller.signal);
    return { result, timedOut: false };
  } catch (err) {
    if (controller.signal.aborted) {
      return { result: undefined, timedOut: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
