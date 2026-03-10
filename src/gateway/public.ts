/**
 * Intended live public gateway surface.
 *
 * Compatibility-only exports live in `src/gateway/compatibility.ts`. The
 * historical mixed gateway barrel remains at `src/gateway/index.ts`.
 */

// Main server
export { GatewayServer, type GatewayServerDependencies } from './gateway-server.js';

// Types
export {
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type Frame,
  type RpcError,
  type Permission,
  type SessionData,
  type ConnectionInfo,
  type AuthChallenge,
  type PairingToken,
  type AuthResult,
  type GatewayConfig,
  type GatewayEventType,
  type GatewayEvent,
  type Subscription,
  DEFAULT_GATEWAY_CONFIG,
} from './types.js';

// Errors
export {
  GatewayError,
  ErrorCodes,
  ErrorMessages,
  createRpcError,
  isGatewayError,
  type ErrorCode,
} from './errors.js';

// Connection
export { Session } from './connection/session.js';
export { ConnectionManager, type ConnectionManagerConfig } from './connection/connection-manager.js';
export { HeartbeatHandler, type HeartbeatConfig } from './connection/heartbeat.js';

// Auth
export { AuthManager, type AuthManagerConfig } from './auth/auth-manager.js';
export { ChallengeGenerator, type Challenge, type ChallengeGeneratorConfig } from './auth/challenge-generator.js';
export { SignatureVerifier } from './auth/signature-verifier.js';
export { PairingTokenStore } from './auth/pairing-token-store.js';

// Protocol
export { MessageParser, type ParseResult } from './protocol/message-parser.js';
export { MessageRouter } from './protocol/message-router.js';

// RPC
export { RpcHandler } from './rpc/rpc-handler.js';
export { MethodRegistry } from './rpc/method-registry.js';

// Events
export { EventBus, gatewayEventBus, type EventHandler, type IEventBus } from './events/event-bus.js';
export { EventEmitter } from './events/event-emitter.js';
export { BroadcastManager } from './events/broadcast-manager.js';

// Live integration boundaries
export {
  GatewayDaemonAttachment,
  type GatewayDaemonAttachmentPhase,
  type GatewayDaemonAttachmentStatus,
  type GatewayDaemonDetachPhase,
  type GatewayDaemonDetachStatus,
  type GatewayDaemonDetachSurface,
  type GatewayDaemonOperationState,
  type GatewayDaemonAttachmentSurface,
  SchedulerBridge,
} from './integration/boundaries.js';
