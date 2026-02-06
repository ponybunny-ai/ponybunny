/**
 * Gateway Types - WebSocket communication layer types
 */

// ============================================================================
// JSON-RPC Frame Types
// ============================================================================

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
  error?: RpcError;
}

export interface EventFrame {
  type: 'event';
  event: string;
  data: unknown;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// Session & Connection Types
// ============================================================================

export type Permission = 'read' | 'write' | 'admin';

export interface SessionData {
  id: string;
  publicKey: string;
  permissions: Permission[];
  connectedAt: number;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
}

export interface ConnectionInfo {
  sessionId: string;
  remoteAddress: string;
  connectedAt: number;
  authenticated: boolean;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthChallenge {
  challenge: string;
  expiresAt: number;
}

export interface PairingToken {
  id: string;
  tokenHash: string;
  publicKey?: string;
  permissions: Permission[];
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface AuthResult {
  success: boolean;
  session?: SessionData;
  error?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface GatewayConfig {
  host: string;
  port: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxConnectionsPerIp: number;
  authTimeoutMs: number;
  enableTls: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  host: '127.0.0.1',
  port: 18789,
  heartbeatIntervalMs: 30000,
  heartbeatTimeoutMs: 10000,
  maxConnectionsPerIp: 10,
  authTimeoutMs: 30000,
  enableTls: false,
};

// ============================================================================
// RPC Method Types
// ============================================================================

// Note: RpcMethodHandler uses SessionData interface. The actual Session class
// implements this interface and is used in the handlers.
export interface RpcMethodHandler<TParams = unknown, TResult = unknown> {
  (params: TParams, session: SessionData): Promise<TResult>;
}

export interface RpcMethodDefinition {
  name: string;
  requiredPermissions: Permission[];
  handler: RpcMethodHandler;
}

// ============================================================================
// Event Types
// ============================================================================

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
// Subscription Types
// ============================================================================

export interface Subscription {
  id: string;
  sessionId: string;
  goalId?: string;
  eventTypes: GatewayEventType[];
  createdAt: number;
}
