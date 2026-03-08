/**
 * IPC Bridge - Routes IPC messages to Gateway EventBus
 *
 * Subscribes to IPC server messages and routes them to the appropriate
 * Gateway subsystems (EventBus for scheduler events, debugEmitter for debug events).
 */

import type { EventBus } from '../events/event-bus.js';
import type { IPCServer, IPCMessageHandler } from '../../ipc/ipc-server.js';
import type {
  AnyIPCMessage,
  SchedulerCommandRequest,
  SchedulerCommandType,
} from '../../ipc/types.js';
import { debugEmitter } from '../../debug/emitter.js';
import type { ConversationLifecycleState, IConversationTurn } from '../../domain/conversation/session.js';
import type { ConversationState } from '../../domain/conversation/state-machine-rules.js';
import type { Goal } from '../../work-order/types/index.js';

interface PendingCommand {
  resolve: (value?: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  startedAt: number;
}

export class IPCBridge {
  private eventBus: EventBus;
  private ipcServer: IPCServer | null = null;
  private messageHandler: IPCMessageHandler | null = null;
  private pendingCommands = new Map<string, PendingCommand>();
  private schedulerSessionToGatewaySession = new Map<string, string>();
  private schedulerCommandAckLatenciesMs: number[] = [];
  private streamChunkLatenciesMs: number[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Connect to an IPC server and start routing messages.
   */
  connect(ipcServer: IPCServer): void {
    if (this.ipcServer) {
      console.warn('[IPCBridge] Already connected to an IPC server');
      return;
    }

    this.ipcServer = ipcServer;

    // Create message handler
    this.messageHandler = (message: AnyIPCMessage, clientId: string) => {
      this.handleIPCMessage(message, clientId);
    };

    // Subscribe to IPC messages
    ipcServer.onMessage(this.messageHandler);

    console.log('[IPCBridge] Connected to IPC server');
  }

  /**
   * Disconnect from the IPC server.
   */
  disconnect(): void {
    if (this.ipcServer && this.messageHandler) {
      this.ipcServer.offMessage(this.messageHandler);
      this.ipcServer = null;
      this.messageHandler = null;
      this.clearPendingCommands('IPC bridge disconnected');
      console.log('[IPCBridge] Disconnected from IPC server');
    }
  }

  /**
   * Check if bridge is connected.
   */
  isConnected(): boolean {
    return this.ipcServer !== null;
  }

  isSchedulerDaemonConnected(): boolean {
    return this.findSchedulerDaemonClientId() !== null;
  }

  async submitGoal(goalId: string): Promise<void> {
    await this.sendSchedulerCommand('submit_goal', { goalId });
  }

  async materializeGoal(params: {
    goalSpec: {
      title: string;
      description: string;
      success_criteria: Array<{
        description: string;
        type: 'heuristic' | 'deterministic';
        verification_method: string;
        required?: boolean;
      }>;
      priority?: number;
      budget_tokens?: number;
      budget_time_minutes?: number;
      budget_cost_usd?: number;
      context?: Record<string, unknown>;
    };
    initialWorkItemSpec?: {
      title: string;
      description: string;
      item_type: 'analysis' | 'code' | 'test' | 'doc' | 'refactor';
      priority?: number;
      dependencies?: string[];
      context?: Record<string, unknown>;
    };
    autoSubmitGoal?: boolean;
  }): Promise<{
    goal: Goal;
    initialWorkItemId?: string;
  }> {
    const result = await this.sendSchedulerCommand('materialize_goal', params);
    return result as { goal: Goal; initialWorkItemId?: string };
  }

  async cancelGoal(goalId: string, reason?: string): Promise<void> {
    await this.sendSchedulerCommand('cancel_goal', { goalId, reason });
  }

  async openSession(params: {
    gatewaySessionId: string;
    personaId?: string;
    userProfileId?: string;
    channelType?: string;
    channelSessionId?: string;
  }): Promise<{
    sessionId: string;
    personaId: string;
    state: ConversationState;
    lifecycleState: ConversationLifecycleState;
  }> {
    const result = await this.sendSchedulerCommand('session_open', params);
    return result as {
      sessionId: string;
      personaId: string;
      state: ConversationState;
      lifecycleState: ConversationLifecycleState;
    };
  }

  async listSessions(params: {
    limit?: number;
    lifecycleState?: 'active' | 'archived';
  }): Promise<{
    sessions: Array<{
      id: string;
      personaId: string;
      title?: string;
      state: ConversationState;
      lifecycleState: ConversationLifecycleState;
      archivedAt?: number;
      archiveSummary?: string;
      turnCount: number;
      lastMessage?: string;
      createdAt: number;
      updatedAt: number;
    }>;
  }> {
    const result = await this.sendSchedulerCommand('session_list', params);
    return result as {
      sessions: Array<{
        id: string;
        personaId: string;
        title?: string;
        state: ConversationState;
        lifecycleState: ConversationLifecycleState;
        archivedAt?: number;
        archiveSummary?: string;
        turnCount: number;
        lastMessage?: string;
        createdAt: number;
        updatedAt: number;
      }>;
    };
  }

  async sendSessionMessage(params: {
    gatewaySessionId: string;
    sessionId?: string;
    personaId?: string;
    userProfileId?: string;
    channelType?: string;
    channelSessionId?: string;
    message: string;
    attachments?: Array<{
      type: 'image' | 'file' | 'audio';
      url?: string;
      base64?: string;
      mimeType: string;
      filename?: string;
    }>;
    stream?: boolean;
  }): Promise<{
    sessionId: string;
    response: string;
    state: ConversationState;
    decision?: 'goal_created' | 'clarification_requested' | 'response_only';
    decisionReason?: string;
    taskInfo?: {
      goalId: string;
      status: string;
      progress?: number;
    };
  }> {
    const result = await this.sendSchedulerCommand('session_message', params);
    return result as {
      sessionId: string;
      response: string;
      state: ConversationState;
      decision?: 'goal_created' | 'clarification_requested' | 'response_only';
      decisionReason?: string;
      taskInfo?: {
        goalId: string;
        status: string;
        progress?: number;
      };
    };
  }

  async getSessionHistory(params: {
    sessionId: string;
    limit?: number;
  }): Promise<{
    turns: IConversationTurn[];
  }> {
    const result = await this.sendSchedulerCommand('session_history', params);
    return result as { turns: IConversationTurn[] };
  }

  async endSession(params: { sessionId: string }): Promise<{ success: boolean }> {
    const result = await this.sendSchedulerCommand('session_end', params);
    return result as { success: boolean };
  }

  async archiveSession(params: {
    sessionId: string;
  }): Promise<{ success: boolean; archivedAt?: number; summary?: string }> {
    const result = await this.sendSchedulerCommand('session_archive', params);
    return result as { success: boolean; archivedAt?: number; summary?: string };
  }

  async resumeSession(params: { sessionId: string }): Promise<{ success: boolean }> {
    const result = await this.sendSchedulerCommand('session_resume', params);
    return result as { success: boolean };
  }

  async getSessionStatus(params: {
    sessionId: string;
  }): Promise<{
    exists: boolean;
    state?: ConversationState;
    lifecycleState?: ConversationLifecycleState;
    archivedAt?: number;
    turnCount?: number;
  }> {
    const result = await this.sendSchedulerCommand('session_status', params);
    return result as {
      exists: boolean;
      state?: ConversationState;
      lifecycleState?: ConversationLifecycleState;
      archivedAt?: number;
      turnCount?: number;
    };
  }

  async applyRuntimeRollout(rollout: NonNullable<SchedulerCommandRequest['rollout']>): Promise<void> {
    await this.sendSchedulerCommand('apply_runtime_rollout', { rollout });
  }

  async setAgentModelOverride(params: {
    agentId: string;
    model: string;
  }): Promise<{ success: boolean; agentId: string; model: string; configPath: string }> {
    const result = await this.sendSchedulerCommand('set_agent_model_override', params);
    return result as { success: boolean; agentId: string; model: string; configPath: string };
  }

  async getAgentModelOverride(params: {
    agentId: string;
  }): Promise<{ agentId: string; model: string | null }> {
    const result = await this.sendSchedulerCommand('get_agent_model_override', params);
    return result as { agentId: string; model: string | null };
  }

  getRealtimeMetrics(): {
    schedulerCommandAckMsP95: number;
    streamChunkLatencyMsP95: number;
    ackSampleSize: number;
    streamSampleSize: number;
  } {
    return {
      schedulerCommandAckMsP95: this.computeP95(this.schedulerCommandAckLatenciesMs),
      streamChunkLatencyMsP95: this.computeP95(this.streamChunkLatenciesMs),
      ackSampleSize: this.schedulerCommandAckLatenciesMs.length,
      streamSampleSize: this.streamChunkLatenciesMs.length,
    };
  }

  /**
   * Handle incoming IPC message and route to appropriate subsystem.
   */
  private handleIPCMessage(message: AnyIPCMessage, clientId: string): void {
    switch (message.type) {
      case 'scheduler_event':
        this.handleSchedulerEvent(message, clientId);
        break;

      case 'session_event':
        this.handleSessionEvent(message);
        break;

      case 'debug_event':
        this.handleDebugEvent(message, clientId);
        break;

      case 'run_event_retention':
        this.handleRunEventRetention(message);
        break;

      case 'scheduler_command_result':
        this.handleSchedulerCommandResult(message);
        break;

      default:
        // Ignore ping/pong/connect/disconnect messages
        break;
    }
  }

  private handleRunEventRetention(message: AnyIPCMessage): void {
    if (message.type !== 'run_event_retention' || !message.data) {
      return;
    }

    const sample = message.data as {
      deleted?: number;
      ok?: boolean;
      timestamp?: number;
    };

    this.eventBus.emit('runtime.retention.run', {
      deleted: typeof sample.deleted === 'number' ? sample.deleted : 0,
      ok: sample.ok === true,
      timestamp: typeof sample.timestamp === 'number' ? sample.timestamp : Date.now(),
    });
  }

  /**
   * Handle scheduler event from Daemon.
   * Routes to EventBus using the same pattern as SchedulerBridge.
   */
  private handleSchedulerEvent(message: AnyIPCMessage, _clientId: string): void {
    if (message.type !== 'scheduler_event' || !message.data) {
      return;
    }

    const event = message.data as any;

    if (typeof event.timestamp === 'number') {
      const transportLatencyMs = Math.max(0, Date.now() - event.timestamp);
      if (event.type === 'llm_stream_chunk') {
        this.recordSample(this.streamChunkLatenciesMs, transportLatencyMs, 500);
      }
    }

    const schedulerEnvelope = this.extractSchedulerEnvelope(event.data);

    // Route to EventBus based on event type
    // This mirrors the logic in SchedulerBridge
    switch (event.type) {
      case 'goal_started':
        this.eventBus.emit('goal.started', {
          goalId: event.goalId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'goal_completed':
        this.eventBus.emit('goal.completed', {
          goalId: event.goalId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'goal_failed':
        this.eventBus.emit('goal.failed', {
          goalId: event.goalId,
          error: event.data?.error,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_started':
        this.eventBus.emit('workitem.started', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          model: event.data?.model,
          laneId: event.data?.laneId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_in_progress':
        this.eventBus.emit('workitem.in_progress', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          stage: event.data?.stage,
          progress: event.data?.progress,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_ended':
        this.eventBus.emit('workitem.ended', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          outcome: event.data?.outcome,
          error: event.data?.error,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_completed':
        this.eventBus.emit('workitem.completed', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_failed':
        this.eventBus.emit('workitem.failed', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          error: event.data?.error,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'run_started':
        this.eventBus.emit('run.started', {
          runId: event.runId,
          workItemId: event.workItemId,
          goalId: event.goalId,
          selectedModel: event.data?.selected_model,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'run_completed':
        this.eventBus.emit('run.completed', {
          runId: event.runId,
          workItemId: event.workItemId,
          goalId: event.goalId,
          success: event.data?.success,
          selectedModel: event.data?.selected_model,
          actualModel: event.data?.actual_model,
          endpointId: event.data?.endpoint_id,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'verification_started':
        this.eventBus.emit('verification.started', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'verification_completed':
        this.eventBus.emit('verification.completed', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          passed: event.data?.passed,
          summary: event.data?.summary,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'escalation_created':
        this.eventBus.emit('escalation.created', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          type: event.data?.type,
          error: event.data?.error,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'escalation_resolved':
        this.eventBus.emit('escalation.resolved', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'budget_warning':
        this.eventBus.emit('budget.warning', {
          goalId: event.goalId,
          level: event.data?.level,
          status: event.data?.status,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      case 'budget_exceeded':
        this.eventBus.emit('budget.exceeded', {
          goalId: event.goalId,
          ...schedulerEnvelope,
          timestamp: event.timestamp,
        });
        break;

      default:
        console.warn(`[IPCBridge] Unknown scheduler event type: ${event.type}`);
    }
  }

  private extractSchedulerEnvelope(data: unknown): {
    gatewaySessionId?: string;
    sessionId?: string;
    channelType?: string;
    channelSessionId?: string;
  } {
    if (!data || typeof data !== 'object') {
      return {};
    }

    const payload = data as Record<string, unknown>;
    const sessionId = typeof payload.sessionId === 'string' && payload.sessionId.length > 0
      ? payload.sessionId
      : undefined;
    const channelSessionId = typeof payload.channelSessionId === 'string' && payload.channelSessionId.length > 0
      ? payload.channelSessionId
      : undefined;
    const channelType = typeof payload.channelType === 'string' && payload.channelType.length > 0
      ? payload.channelType
      : undefined;

    const gatewaySessionId = sessionId ? this.schedulerSessionToGatewaySession.get(sessionId) : undefined;

    return {
      ...(gatewaySessionId ? { gatewaySessionId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(channelType ? { channelType } : {}),
      ...(channelSessionId ? { channelSessionId } : {}),
    };
  }

  /**
   * Handle debug event from Daemon.
   * Routes to debugEmitter for broadcasting to debug clients.
   */
  private handleDebugEvent(message: AnyIPCMessage, _clientId: string): void {
    if (message.type !== 'debug_event' || !message.data) {
      return;
    }

    const event = message.data as {
      id?: string;
      timestamp?: number;
      type: string;
      source: string;
      data: Record<string, unknown>;
      goalId?: string;
      workItemId?: string;
      runId?: string;
    };

    // Re-emit debug event through debugEmitter
    // This allows DebugBroadcaster to pick it up and send to clients
    if (debugEmitter.isEnabled()) {
      if (typeof event.id === 'string' && typeof event.timestamp === 'number') {
        debugEmitter.emitRaw({
          id: event.id,
          timestamp: event.timestamp,
          type: event.type,
          source: event.source,
          data: event.data,
          goalId: event.goalId,
          workItemId: event.workItemId,
          runId: event.runId,
        });
      } else {
        debugEmitter.emitDebug(event.type, event.source, event.data);
      }
    }
  }

  private handleSessionEvent(message: AnyIPCMessage): void {
    if (message.type !== 'session_event' || !message.data) {
      return;
    }

    const eventData = message.data as {
      event?: string;
      gatewaySessionId?: string;
      sessionId?: string;
      payload?: Record<string, unknown>;
    };

    if (typeof eventData.event !== 'string' || eventData.event.length === 0) {
      return;
    }

    const payload = {
      ...(eventData.payload ?? {}),
      ...(typeof eventData.sessionId === 'string' ? { sessionId: eventData.sessionId } : {}),
      ...(typeof eventData.gatewaySessionId === 'string' ? { gatewaySessionId: eventData.gatewaySessionId } : {}),
      timestamp: Date.now(),
    };

    if (typeof eventData.sessionId === 'string' && typeof eventData.gatewaySessionId === 'string') {
      this.schedulerSessionToGatewaySession.set(eventData.sessionId, eventData.gatewaySessionId);
    }

    this.eventBus.emit(eventData.event, payload);
  }

  private async sendSchedulerCommand(
    command: SchedulerCommandType,
    params: Omit<SchedulerCommandRequest, 'requestId' | 'command'>
  ): Promise<unknown> {
    const ipcServer = this.ipcServer;
    if (!ipcServer) {
      throw new Error('IPC server is not connected');
    }

    const schedulerClientId = this.findSchedulerDaemonClientId();
    if (!schedulerClientId) {
      throw new Error('Scheduler daemon is not connected');
    }

    const requestId = `ipc-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return await new Promise<unknown>((resolve, reject) => {
      const startedAt = Date.now();
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Scheduler command timed out: ${command}`));
      }, 5000);

      this.pendingCommands.set(requestId, { resolve, reject, timeout, startedAt });

      try {
        ipcServer.sendToClient(schedulerClientId, {
          type: 'scheduler_command',
          timestamp: Date.now(),
          data: {
            requestId,
            command,
            ...params,
          },
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingCommands.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleSchedulerCommandResult(message: AnyIPCMessage): void {
    if (message.type !== 'scheduler_command_result' || !message.data) {
      return;
    }

    const requestId = typeof message.data.requestId === 'string' ? message.data.requestId : null;
    if (!requestId) {
      return;
    }

    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(requestId);
    this.recordSample(this.schedulerCommandAckLatenciesMs, Math.max(0, Date.now() - pending.startedAt), 500);

    if (message.data.success) {
      pending.resolve(message.data.result);
      return;
    }

    const errorMessage =
      typeof message.data.error === 'string' && message.data.error.length > 0
        ? message.data.error
        : 'Scheduler command failed';
    pending.reject(new Error(errorMessage));
  }

  private findSchedulerDaemonClientId(): string | null {
    if (!this.ipcServer) {
      return null;
    }

    const clients = this.ipcServer.getClients();
    const schedulerClient = clients.find((client) => client.clientInfo?.clientType === 'scheduler-daemon');
    return schedulerClient?.id ?? null;
  }

  private clearPendingCommands(reason: string): void {
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pendingCommands.delete(requestId);
    }
  }

  private recordSample(samples: number[], value: number, maxSamples: number): void {
    samples.push(value);
    if (samples.length > maxSamples) {
      samples.splice(0, samples.length - maxSamples);
    }
  }

  private computeP95(samples: number[]): number {
    if (samples.length === 0) {
      return 0;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index] ?? 0;
  }
}
