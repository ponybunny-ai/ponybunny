import { createHash } from 'node:crypto';

import type { IConversationResponse } from '../../app/conversation/session-manager.js';
import type { ConversationPort, ConversationRequest, ConversationResult } from '../conversation-boundary/index.js';

export type ConversationWorkerInspectionOutcome = 'in_flight' | 'success' | 'failure' | 'invalid';

export interface ConversationWorkerInspectionRecord {
  conversationRequestId: string;
  requestedSessionId?: string;
  resultSessionId?: string;
  messageDigest: string;
  messageLength: number;
  outcome: ConversationWorkerInspectionOutcome;
  resultMatchedRequestId: boolean;
  sessionIdMatched?: boolean;
  duplicateSuppressed: boolean;
  duplicateDispatchCount: number;
  dispatchedAt: number;
  completedAt?: number;
  failureCode?: string;
  failureMessage?: string;
}

export interface ConversationWorkerInspectionSummary {
  totalRequests: number;
  inFlightCount: number;
  recentCount: number;
  successCount: number;
  failureCount: number;
  invalidCount: number;
  duplicateSuppressedCount: number;
}

export interface ConversationWorkerInspectionSnapshot {
  summary: ConversationWorkerInspectionSummary;
  inFlight: ConversationWorkerInspectionRecord[];
  recent: ConversationWorkerInspectionRecord[];
}

interface ConversationWorkerMutableInspectionRecord extends ConversationWorkerInspectionRecord {
  sequence: number;
}

interface InFlightConversationRequest {
  fingerprint: string;
  promise: Promise<ConversationResult>;
}

interface ConversationOrchestrator {
  processMessage(
    message: string,
    sessionId?: string,
    personaId?: string,
    userProfileId?: string,
    attachments?: ConversationRequest['attachments'],
    agentId?: string
  ): Promise<IConversationResponse>;
}

class ConversationWorkerIntegrityError extends Error {
  constructor(
    readonly code:
      | 'CONVERSATION_REQUEST_INVALID'
      | 'CONVERSATION_REQUEST_CONFLICT'
      | 'CONVERSATION_RESULT_INVALID'
      | 'CONVERSATION_WORKER_EXCEPTION',
    message: string
  ) {
    super(message);
    this.name = 'ConversationWorkerIntegrityError';
  }
}

export class ConversationWorker implements ConversationPort {
  private readonly inspectionsByRequestId = new Map<string, ConversationWorkerMutableInspectionRecord>();
  private readonly inFlightByRequestId = new Map<string, InFlightConversationRequest>();
  private inspectionSequence = 0;

  constructor(private readonly orchestrator: ConversationOrchestrator) {}

  async process(request: ConversationRequest): Promise<ConversationResult> {
    const validationError = this.validateRequest(request);
    if (validationError) {
      throw validationError;
    }

    const inspection = this.getOrCreateInspection(request);
    const fingerprint = this.buildRequestFingerprint(request);
    const inFlight = this.inFlightByRequestId.get(request.conversationRequestId);
    if (inFlight) {
      inspection.duplicateDispatchCount += 1;
      if (inFlight.fingerprint !== fingerprint) {
        throw new ConversationWorkerIntegrityError(
          'CONVERSATION_REQUEST_CONFLICT',
          `Conversation request '${request.conversationRequestId}' was re-dispatched with different identity fields while already in flight`
        );
      }

      inspection.duplicateSuppressed = true;
      return inFlight.promise;
    }

    const promise = this.executeRequest(request, inspection);
    this.inFlightByRequestId.set(request.conversationRequestId, {
      fingerprint,
      promise,
    });

    try {
      return await promise;
    } finally {
      const current = this.inFlightByRequestId.get(request.conversationRequestId);
      if (current?.promise === promise) {
        this.inFlightByRequestId.delete(request.conversationRequestId);
      }
    }
  }

  inspect(): ConversationWorkerInspectionSnapshot {
    const records = Array.from(this.inspectionsByRequestId.values())
      .sort((left, right) => left.sequence - right.sequence)
      .map((record) => this.cloneInspection(record));

    return {
      summary: this.buildInspectionSummary(records),
      inFlight: records.filter((record) => record.outcome === 'in_flight'),
      recent: records.filter((record) => record.outcome !== 'in_flight'),
    };
  }

  private async executeRequest(
    request: ConversationRequest,
    inspection: ConversationWorkerMutableInspectionRecord
  ): Promise<ConversationResult> {
    try {
      const result = await this.orchestrator.processMessage(
        request.message,
        request.sessionId,
        request.personaId,
        request.userProfileId,
        request.attachments,
        request.agentId
      );

      const normalizedResult = this.normalizeResult(request, result);
      this.completeInspection(inspection, 'success', undefined, {
        resultSessionId: normalizedResult.sessionId,
        resultMatchedRequestId: normalizedResult.conversationRequestId === request.conversationRequestId,
      });
      return normalizedResult;
    } catch (error) {
      const normalizedError = error instanceof ConversationWorkerIntegrityError
        ? error
        : new ConversationWorkerIntegrityError(
          'CONVERSATION_WORKER_EXCEPTION',
          error instanceof Error ? error.message : String(error)
        );

      this.completeInspection(inspection, normalizedError.code === 'CONVERSATION_RESULT_INVALID' ? 'invalid' : 'failure', normalizedError, {
        resultMatchedRequestId: false,
      });
      throw normalizedError;
    }
  }

  private normalizeResult(
    request: ConversationRequest,
    result: IConversationResponse
  ): ConversationResult {
    if (typeof result.sessionId !== 'string' || result.sessionId.trim().length === 0) {
      throw new ConversationWorkerIntegrityError(
        'CONVERSATION_RESULT_INVALID',
        `Conversation request '${request.conversationRequestId}' returned an invalid sessionId`
      );
    }

    if (typeof result.response !== 'string') {
      throw new ConversationWorkerIntegrityError(
        'CONVERSATION_RESULT_INVALID',
        `Conversation request '${request.conversationRequestId}' returned a non-string response payload`
      );
    }

    return {
      conversationRequestId: request.conversationRequestId,
      sessionId: result.sessionId,
      response: result.response,
      state: result.state,
      decision: result.decision,
      decisionReason: result.decisionReason,
      taskInfo: result.taskInfo,
    };
  }

  private validateRequest(request: ConversationRequest): ConversationWorkerIntegrityError | null {
    const missingFields: string[] = [];
    if (typeof request.conversationRequestId !== 'string' || request.conversationRequestId.trim().length === 0) {
      missingFields.push('conversationRequestId');
    }
    if (typeof request.message !== 'string' || request.message.trim().length === 0) {
      missingFields.push('message');
    }

    if (missingFields.length === 0) {
      return null;
    }

    return new ConversationWorkerIntegrityError(
      'CONVERSATION_REQUEST_INVALID',
      `Invalid conversation request: missing ${missingFields.join(', ')}`
    );
  }

  private getOrCreateInspection(request: ConversationRequest): ConversationWorkerMutableInspectionRecord {
    const existing = this.inspectionsByRequestId.get(request.conversationRequestId);
    if (existing) {
      return existing;
    }

    const created: ConversationWorkerMutableInspectionRecord = {
      conversationRequestId: request.conversationRequestId,
      requestedSessionId: request.sessionId,
      messageDigest: this.buildMessageDigest(request.message),
      messageLength: request.message.length,
      outcome: 'in_flight',
      resultMatchedRequestId: true,
      duplicateSuppressed: false,
      duplicateDispatchCount: 0,
      dispatchedAt: Date.now(),
      sequence: this.inspectionSequence++,
    };
    this.inspectionsByRequestId.set(request.conversationRequestId, created);
    return created;
  }

  private completeInspection(
    inspection: ConversationWorkerMutableInspectionRecord,
    outcome: Exclude<ConversationWorkerInspectionOutcome, 'in_flight'>,
    error?: ConversationWorkerIntegrityError,
    metadata?: {
      resultSessionId?: string;
      resultMatchedRequestId?: boolean;
    }
  ): void {
    inspection.outcome = outcome;
    inspection.resultSessionId = metadata?.resultSessionId;
    inspection.resultMatchedRequestId = metadata?.resultMatchedRequestId ?? true;
    inspection.sessionIdMatched = typeof inspection.requestedSessionId === 'string' && typeof metadata?.resultSessionId === 'string'
      ? inspection.requestedSessionId === metadata.resultSessionId
      : undefined;
    inspection.completedAt = Date.now();
    inspection.failureCode = error?.code;
    inspection.failureMessage = error?.message;
  }

  private buildRequestFingerprint(request: ConversationRequest): string {
    const attachmentFingerprint = (request.attachments ?? []).map((attachment) => ({
      type: attachment.type,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      url: attachment.url,
      hasBase64: typeof attachment.base64 === 'string' && attachment.base64.length > 0,
    }));

    return JSON.stringify({
      sessionId: request.sessionId,
      personaId: request.personaId,
      userProfileId: request.userProfileId,
      agentId: request.agentId,
      messageDigest: this.buildMessageDigest(request.message),
      attachments: attachmentFingerprint,
    });
  }

  private buildMessageDigest(message: string): string {
    return createHash('sha1').update(message).digest('hex');
  }

  private buildInspectionSummary(records: ConversationWorkerInspectionRecord[]): ConversationWorkerInspectionSummary {
    return {
      totalRequests: records.length,
      inFlightCount: records.filter((record) => record.outcome === 'in_flight').length,
      recentCount: records.filter((record) => record.outcome !== 'in_flight').length,
      successCount: records.filter((record) => record.outcome === 'success').length,
      failureCount: records.filter((record) => record.outcome === 'failure').length,
      invalidCount: records.filter((record) => record.outcome === 'invalid').length,
      duplicateSuppressedCount: records.filter((record) => record.duplicateSuppressed).length,
    };
  }

  private cloneInspection(record: ConversationWorkerInspectionRecord): ConversationWorkerInspectionRecord {
    return {
      ...record,
    };
  }
}
