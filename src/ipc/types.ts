/**
 * IPC Protocol Types
 *
 * Defines the message protocol for inter-process communication between
 * Gateway and Scheduler Daemon via Unix domain socket.
 */

import type { SchedulerEvent } from '../scheduler/types.js';
import type { DebugEvent } from '../debug/types.js';

/**
 * Base IPC message structure.
 * All messages sent over the IPC channel follow this format.
 */
export interface IPCMessage {
  /** Message type identifier */
  type:
    | 'scheduler_event'
    | 'session_event'
    | 'debug_event'
    | 'run_event_retention'
    | 'scheduler_command'
    | 'scheduler_command_result'
    | 'ping'
    | 'pong'
    | 'connect'
    | 'disconnect';
  /** Message timestamp in milliseconds */
  timestamp: number;
  /** Message-specific payload */
  data?: unknown;
}

/**
 * Scheduler event message sent from Daemon to Gateway.
 * Contains lifecycle events (goal/workitem/run state changes).
 */
export interface IPCSchedulerEventMessage extends IPCMessage {
  type: 'scheduler_event';
  data: SchedulerEvent;
}

/**
 * Session event message sent from Scheduler Daemon to Gateway.
 * Contains session-scoped conversation/runtime events that must be routed
 * to the originating gateway websocket session.
 */
export interface IPCSessionEventMessage extends IPCMessage {
  type: 'session_event';
  data: {
    event: string;
    gatewaySessionId?: string;
    sessionId?: string;
    payload?: Record<string, unknown>;
  };
}

/**
 * Debug event message sent from Daemon to Gateway.
 * Contains detailed instrumentation events for debugging.
 */
export interface IPCDebugEventMessage extends IPCMessage {
  type: 'debug_event';
  data: DebugEvent;
}

export interface IPCRunEventRetentionMessage extends IPCMessage {
  type: 'run_event_retention';
  data: {
    deleted: number;
    ok: boolean;
    timestamp: number;
  };
}

export type SchedulerCommandType =
  | 'submit_goal'
  | 'cancel_goal'
  | 'apply_runtime_rollout'
  | 'session_open'
  | 'session_list'
  | 'session_message'
  | 'session_history'
  | 'session_end'
  | 'session_archive'
  | 'session_resume'
  | 'session_status';

export interface SchedulerCommandRequest {
  requestId: string;
  command: SchedulerCommandType;
  gatewaySessionId?: string;
  channelType?: string;
  channelSessionId?: string;
  sessionId?: string;
  personaId?: string;
  userProfileId?: string;
  lifecycleState?: 'active' | 'archived';
  message?: string;
  attachments?: Array<{
    type: 'image' | 'file' | 'audio';
    url?: string;
    base64?: string;
    mimeType: string;
    filename?: string;
  }>;
  stream?: boolean;
  limit?: number;
  goalId?: string;
  reason?: string;
  rollout?: {
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
    runtimeRollout: {
      shadowModeEnabled: boolean;
      canaryPercent: number;
      rollbackOnFailure: boolean;
      lanePercents: {
        dryRun: number;
        compile: number;
        replay: number;
      };
    };
  };
}

export interface SchedulerCommandResponse {
  requestId: string;
  success: boolean;
  error?: string;
  result?: unknown;
}

export interface IPCSchedulerCommandMessage extends IPCMessage {
  type: 'scheduler_command';
  data: SchedulerCommandRequest;
}

export interface IPCSchedulerCommandResultMessage extends IPCMessage {
  type: 'scheduler_command_result';
  data: SchedulerCommandResponse;
}

/**
 * Ping message for keepalive/heartbeat.
 * Sent by server to check client connection health.
 */
export interface IPCPingMessage extends IPCMessage {
  type: 'ping';
  data?: undefined;
}

/**
 * Pong message in response to ping.
 * Sent by client to acknowledge server ping.
 */
export interface IPCPongMessage extends IPCMessage {
  type: 'pong';
  data?: undefined;
}

/**
 * Connect message sent by client on initial connection.
 * Contains client identification and version info.
 */
export interface IPCConnectMessage extends IPCMessage {
  type: 'connect';
  data: {
    clientType: 'scheduler-daemon';
    version: string;
    pid: number;
  };
}

/**
 * Disconnect message sent by client before closing connection.
 * Allows graceful shutdown notification.
 */
export interface IPCDisconnectMessage extends IPCMessage {
  type: 'disconnect';
  data?: {
    reason?: string;
  };
}

/**
 * Union type of all possible IPC messages.
 */
export type AnyIPCMessage =
  | IPCSchedulerEventMessage
  | IPCSessionEventMessage
  | IPCDebugEventMessage
  | IPCRunEventRetentionMessage
  | IPCSchedulerCommandMessage
  | IPCSchedulerCommandResultMessage
  | IPCPingMessage
  | IPCPongMessage
  | IPCConnectMessage
  | IPCDisconnectMessage;

/**
 * IPC connection state.
 */
export type IPCConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * IPC error types.
 */
export enum IPCErrorType {
  CONNECTION_FAILED = 'connection_failed',
  CONNECTION_LOST = 'connection_lost',
  SEND_FAILED = 'send_failed',
  PARSE_ERROR = 'parse_error',
  TIMEOUT = 'timeout',
}

/**
 * IPC error class.
 */
export class IPCError extends Error {
  constructor(
    public readonly type: IPCErrorType,
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'IPCError';
  }
}
