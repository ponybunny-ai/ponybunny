/**
 * Gateway Error Codes and Classes
 *
 * Error codes follow JSON-RPC 2.0 conventions:
 * - -32700: Parse error
 * - -32600: Invalid request
 * - -32601: Method not found
 * - -32602: Invalid params
 * - -32603: Internal error
 * - -32000 to -32099: Server errors (reserved for implementation)
 */

import type { RpcError } from './types.js';

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  // JSON-RPC standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Gateway-specific errors (-32000 to -32099)
  AUTH_REQUIRED: -32001,
  AUTH_FAILED: -32002,
  AUTH_EXPIRED: -32003,
  PERMISSION_DENIED: -32004,
  RATE_LIMITED: -32005,
  CONNECTION_LIMIT: -32006,
  INVALID_TOKEN: -32007,
  CHALLENGE_EXPIRED: -32008,
  SIGNATURE_INVALID: -32009,

  // Resource errors
  GOAL_NOT_FOUND: -32010,
  WORKITEM_NOT_FOUND: -32011,
  ESCALATION_NOT_FOUND: -32012,
  RUN_NOT_FOUND: -32013,
  PERMISSION_REQUEST_NOT_FOUND: -32014,

  // Operation errors
  GOAL_ALREADY_CANCELLED: -32020,
  ESCALATION_ALREADY_RESOLVED: -32021,
  INVALID_STATE_TRANSITION: -32022,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================================
// Error Messages
// ============================================================================

export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCodes.PARSE_ERROR]: 'Parse error: Invalid JSON',
  [ErrorCodes.INVALID_REQUEST]: 'Invalid request: Missing required fields',
  [ErrorCodes.METHOD_NOT_FOUND]: 'Method not found',
  [ErrorCodes.INVALID_PARAMS]: 'Invalid params',
  [ErrorCodes.INTERNAL_ERROR]: 'Internal error',

  [ErrorCodes.AUTH_REQUIRED]: 'Authentication required',
  [ErrorCodes.AUTH_FAILED]: 'Authentication failed',
  [ErrorCodes.AUTH_EXPIRED]: 'Authentication expired',
  [ErrorCodes.PERMISSION_DENIED]: 'Permission denied',
  [ErrorCodes.RATE_LIMITED]: 'Rate limited',
  [ErrorCodes.CONNECTION_LIMIT]: 'Connection limit exceeded',
  [ErrorCodes.INVALID_TOKEN]: 'Invalid pairing token',
  [ErrorCodes.CHALLENGE_EXPIRED]: 'Challenge expired',
  [ErrorCodes.SIGNATURE_INVALID]: 'Invalid signature',

  [ErrorCodes.GOAL_NOT_FOUND]: 'Goal not found',
  [ErrorCodes.WORKITEM_NOT_FOUND]: 'Work item not found',
  [ErrorCodes.ESCALATION_NOT_FOUND]: 'Escalation not found',
  [ErrorCodes.RUN_NOT_FOUND]: 'Run not found',
  [ErrorCodes.PERMISSION_REQUEST_NOT_FOUND]: 'Permission request not found',

  [ErrorCodes.GOAL_ALREADY_CANCELLED]: 'Goal already cancelled',
  [ErrorCodes.ESCALATION_ALREADY_RESOLVED]: 'Escalation already resolved',
  [ErrorCodes.INVALID_STATE_TRANSITION]: 'Invalid state transition',
};

// ============================================================================
// GatewayError Class
// ============================================================================

export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly data?: unknown;

  constructor(code: ErrorCode, message?: string, data?: unknown) {
    super(message || ErrorMessages[code]);
    this.name = 'GatewayError';
    this.code = code;
    this.data = data;
  }

  toRpcError(): RpcError {
    return {
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }

  static fromCode(code: ErrorCode, data?: unknown): GatewayError {
    return new GatewayError(code, ErrorMessages[code], data);
  }

  static parseError(details?: string): GatewayError {
    return new GatewayError(
      ErrorCodes.PARSE_ERROR,
      details ? `Parse error: ${details}` : undefined
    );
  }

  static invalidRequest(details?: string): GatewayError {
    return new GatewayError(
      ErrorCodes.INVALID_REQUEST,
      details ? `Invalid request: ${details}` : undefined
    );
  }

  static methodNotFound(method: string): GatewayError {
    return new GatewayError(
      ErrorCodes.METHOD_NOT_FOUND,
      `Method not found: ${method}`
    );
  }

  static invalidParams(details?: string): GatewayError {
    return new GatewayError(
      ErrorCodes.INVALID_PARAMS,
      details ? `Invalid params: ${details}` : undefined
    );
  }

  static internalError(details?: string): GatewayError {
    return new GatewayError(
      ErrorCodes.INTERNAL_ERROR,
      details ? `Internal error: ${details}` : undefined
    );
  }

  static authRequired(): GatewayError {
    return new GatewayError(ErrorCodes.AUTH_REQUIRED);
  }

  static authFailed(reason?: string): GatewayError {
    return new GatewayError(
      ErrorCodes.AUTH_FAILED,
      reason ? `Authentication failed: ${reason}` : undefined
    );
  }

  static permissionDenied(permission?: string): GatewayError {
    return new GatewayError(
      ErrorCodes.PERMISSION_DENIED,
      permission ? `Permission denied: requires '${permission}'` : undefined
    );
  }

  static notFound(resource: 'goal' | 'workitem' | 'escalation' | 'run' | 'permission_request', id: string): GatewayError {
    const codeMap = {
      goal: ErrorCodes.GOAL_NOT_FOUND,
      workitem: ErrorCodes.WORKITEM_NOT_FOUND,
      escalation: ErrorCodes.ESCALATION_NOT_FOUND,
      run: ErrorCodes.RUN_NOT_FOUND,
      permission_request: ErrorCodes.PERMISSION_REQUEST_NOT_FOUND,
    };
    return new GatewayError(codeMap[resource], `${resource} not found: ${id}`);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

export function createRpcError(code: ErrorCode, message?: string, data?: unknown): RpcError {
  return {
    code,
    message: message || ErrorMessages[code],
    data,
  };
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}
