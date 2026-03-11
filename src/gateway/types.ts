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
  maxLocalConnections?: number;
  authTimeoutMs: number;
  enableTls: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  autoRestart?: boolean;
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

/**
 * Authoritative live gateway event protocol.
 *
 * Legacy gateway-facing `task.*` compatibility events are intentionally kept
 * separate below so the live public surface reflects the protocol that current
 * producers actually emit.
 */
export type GatewayEventType =
  | 'goal.created'
  | 'goal.started'
  | 'goal.updated'
  | 'goal.completed'
  | 'goal.failed'
  | 'goal.cancelled'
  | 'goal.deleted'
  | 'workitem.created'
  | 'workitem.started'
  | 'workitem.in_progress'
  | 'workitem.ended'
  | 'workitem.updated'
  | 'workitem.completed'
  | 'workitem.failed'
  | 'run.started'
  | 'run.completed'
  | 'verification.started'
  | 'verification.completed'
  | 'budget.warning'
  | 'budget.exceeded'
  | 'escalation.created'
  | 'escalation.resolved'
  | 'connection.authenticated'
  | 'connection.disconnected'
  // Conversation events
  | 'conversation.new'
  | 'conversation.message.started'
  | 'conversation.message.succeeded'
  | 'conversation.response'
  | 'conversation.typing'
  | 'conversation.ended'
  | 'conversation.archived'
  | 'conversation.resumed'
  | 'channel.adapter.config.updated'
  | 'channel.adapter.status.updated'
  // LLM streaming events
  | 'llm.stream.start'
  | 'llm.stream.chunk'
  | 'llm.stream.end'
  | 'llm.stream.error';

/**
 * Compatibility-only gateway events retained for older clients.
 *
 * These are not part of the authoritative live gateway protocol.
 */
export type GatewayCompatibilityEventType =
  | 'task.narration'
  | 'task.result';

export type AnyGatewayEventType = GatewayEventType | GatewayCompatibilityEventType;

const GATEWAY_COMPATIBILITY_EVENT_TYPE_SET = new Set<GatewayCompatibilityEventType>([
  'task.narration',
  'task.result',
]);

export function isGatewayCompatibilityEventType(
  eventType: string
): eventType is GatewayCompatibilityEventType {
  return GATEWAY_COMPATIBILITY_EVENT_TYPE_SET.has(eventType as GatewayCompatibilityEventType);
}

export interface GatewayEvent<T = unknown> {
  type: GatewayEventType;
  timestamp: number;
  data: T;
}

export interface GatewayCompatibilityEvent<T = unknown> {
  type: GatewayCompatibilityEventType;
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
