import type { RateLimitInfo, RateLimitReason } from './account-types.js';
import type { HeaderStyle } from './antigravity-constants.js';

const RETRY_AFTER_HEADERS = [
  'retry-after',
  'x-retry-after',
  'x-ratelimit-reset',
  'x-goog-retry-after',
  'x-goog-quota-reset',
];

const GOOGLE_ERROR_INFO = 'type.googleapis.com/google.rpc.ErrorInfo';
const GOOGLE_RETRY_INFO = 'type.googleapis.com/google.rpc.RetryInfo';

type ParsedErrorPayload = {
  message?: string;
  reason?: string;
  retryDelayMs?: number;
};

function parseDurationToMs(value: string): number | undefined {
  const trimmed = value.trim();
  const secondsMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
  if (secondsMatch) {
    return Math.round(parseFloat(secondsMatch[1]!) * 1000);
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) {
      return Math.max(0, Math.round(numeric - Date.now()));
    }
    if (numeric > 1_000_000_000) {
      return Math.max(0, Math.round(numeric * 1000 - Date.now()));
    }
    return Math.max(0, Math.round(numeric * 1000));
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return undefined;
}

function parseRetryAfterMsFromHeaders(headers: Headers): number | undefined {
  for (const header of RETRY_AFTER_HEADERS) {
    const value = headers.get(header);
    if (!value) continue;
    const parsed = parseDurationToMs(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseRetryAfterFromMessage(message?: string): number | undefined {
  if (!message) return undefined;
  const match = message.match(/reset(?:s)?\s+(?:after|in)\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|seconds|m|min|minutes|h|hr|hours)?/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]!);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2]?.toLowerCase();
  if (!unit || unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'seconds') {
    return Math.round(value * 1000);
  }
  if (unit === 'ms') {
    return Math.round(value);
  }
  if (unit === 'm' || unit === 'min' || unit === 'minutes') {
    return Math.round(value * 60 * 1000);
  }
  if (unit === 'h' || unit === 'hr' || unit === 'hours') {
    return Math.round(value * 60 * 60 * 1000);
  }
  return undefined;
}

function parseErrorPayload(payload: unknown): ParsedErrorPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const errorPayload = (payload as { error?: any; message?: string }).error ?? payload;
  const message = typeof errorPayload?.message === 'string' ? errorPayload.message : undefined;

  let reason: string | undefined;
  let retryDelayMs: number | undefined;

  const details = Array.isArray(errorPayload?.details) ? errorPayload.details : [];
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const type = detail['@type'];
    if (type === GOOGLE_ERROR_INFO && typeof detail.reason === 'string') {
      reason = detail.reason;
    }
    if (type === GOOGLE_RETRY_INFO && typeof detail.retryDelay === 'string') {
      const parsed = parseDurationToMs(detail.retryDelay);
      if (parsed !== undefined) {
        retryDelayMs = parsed;
      }
    }
  }

  return {
    message,
    reason,
    retryDelayMs,
  };
}

export function parseRateLimitReason(
  reason: string | undefined,
  message: string | undefined,
  status?: number,
): RateLimitReason {
  if (status === 529) return 'MODEL_CAPACITY_EXHAUSTED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 500) return 'SERVICE_UNAVAILABLE';

  if (reason) {
    switch (reason.toUpperCase()) {
      case 'QUOTA_EXHAUSTED':
        return 'QUOTA_EXHAUSTED';
      case 'RATE_LIMIT_EXCEEDED':
        return 'RATE_LIMIT_EXCEEDED';
      case 'MODEL_CAPACITY_EXHAUSTED':
        return 'MODEL_CAPACITY_EXHAUSTED';
      case 'SERVICE_UNAVAILABLE':
        return 'SERVICE_UNAVAILABLE';
      default:
        break;
    }
  }

  if (message) {
    const lower = message.toLowerCase();
    if (lower.includes('capacity') || lower.includes('overloaded') || lower.includes('resource exhausted')) {
      return 'MODEL_CAPACITY_EXHAUSTED';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('per minute')) {
      return 'RATE_LIMIT_EXCEEDED';
    }
    if (lower.includes('quota') || lower.includes('exhausted')) {
      return 'QUOTA_EXHAUSTED';
    }
    if (lower.includes('service unavailable') || lower.includes('temporarily unavailable')) {
      return 'SERVICE_UNAVAILABLE';
    }
  }

  return 'UNKNOWN';
}

export function detectModelFamily(message?: string, model?: string): 'claude' | 'gemini' | undefined {
  const combined = `${model ?? ''} ${message ?? ''}`.toLowerCase();
  if (combined.includes('claude') || combined.includes('anthropic')) {
    return 'claude';
  }
  if (combined.includes('gemini')) {
    return 'gemini';
  }
  return undefined;
}

export function parseRateLimitInfo(options: {
  response: Response;
  bodyText?: string;
  model?: string;
  headerStyle?: HeaderStyle;
}): RateLimitInfo {
  const { response, bodyText, model, headerStyle } = options;
  const headerRetryMs = parseRetryAfterMsFromHeaders(response.headers);

  let parsedMessage: string | undefined;
  let parsedReason: string | undefined;
  let parsedRetryMs: number | undefined;

  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      const payload = parseErrorPayload(parsed);
      parsedMessage = payload.message;
      parsedReason = payload.reason;
      parsedRetryMs = payload.retryDelayMs;
    } catch {
      parsedMessage = bodyText;
    }
  }

  const messageRetryMs = parseRetryAfterFromMessage(parsedMessage);
  const retryAfter = parsedRetryMs ?? messageRetryMs ?? headerRetryMs;
  const reason = parseRateLimitReason(parsedReason, parsedMessage, response.status);

  const family = detectModelFamily(parsedMessage, model);
  const modelFamily = family === 'gemini'
    ? (headerStyle === 'gemini-cli' ? 'gemini-cli' : 'gemini-antigravity')
    : family;

  return {
    reason,
    retryAfter,
    resetTime: retryAfter ? Date.now() + retryAfter : undefined,
    modelFamily,
  };
}
