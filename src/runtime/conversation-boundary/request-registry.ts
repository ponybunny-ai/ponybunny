import { createHash } from 'node:crypto';

import type { ConversationRequest, ConversationResult } from './conversation-port.js';

export type ConversationRequestRegistryState = 'pending' | 'resolved';
export type ConversationRequestTerminalOutcome = 'success' | 'failure' | 'invalid';

export interface ConversationAttachmentIdentitySummary {
  type: 'image' | 'file' | 'audio';
  mimeType: string;
  filename?: string;
  url?: string;
  hasBase64: boolean;
}

export interface ConversationRequestIdentitySnapshot {
  conversationRequestId: string;
  sessionId?: string;
  personaId?: string;
  userProfileId?: string;
  agentId?: string;
  messageDigest: string;
  attachmentIdentity: ConversationAttachmentIdentitySummary[];
}

export interface ConversationRequestTerminalMetadata {
  outcome: ConversationRequestTerminalOutcome;
  resolvedAt: number;
  resultSessionId?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface ConversationRequestRegistryEntrySnapshot extends ConversationRequestIdentitySnapshot {
  state: ConversationRequestRegistryState;
  registeredAt: number;
  terminal?: ConversationRequestTerminalMetadata;
}

export interface ConversationRequestRegistrySnapshot {
  pending: ConversationRequestRegistryEntrySnapshot[];
  recent: ConversationRequestRegistryEntrySnapshot[];
}

export type ConversationRequestRegistration =
  | {
      kind: 'registered';
      promise: Promise<ConversationResult>;
      owner: ConversationRequestResolutionOwner;
      entry: ConversationRequestRegistryEntrySnapshot;
    }
  | {
      kind: 'duplicate';
      promise: Promise<ConversationResult>;
      entry: ConversationRequestRegistryEntrySnapshot;
    }
  | {
      kind: 'conflict';
      entry: ConversationRequestRegistryEntrySnapshot;
    };

interface ConversationRequestRegistryEntry extends ConversationRequestIdentitySnapshot {
  state: ConversationRequestRegistryState;
  fingerprint: string;
  registeredAt: number;
  terminal?: ConversationRequestTerminalMetadata;
  promise: Promise<ConversationResult>;
  resolve: (result: ConversationResult) => void;
  reject: (error: Error) => void;
}

interface ConversationRequestResolutionMetadata {
  resultSessionId?: string;
}

export class ConversationRequestResolutionOwner {
  private active = true;

  constructor(private readonly entry: ConversationRequestRegistryEntry) {}

  resolveSuccess(result: ConversationResult, metadata?: ConversationRequestResolutionMetadata): boolean {
    if (!this.active || this.entry.state === 'resolved') {
      this.active = false;
      return false;
    }

    this.active = false;
    this.entry.state = 'resolved';
    this.entry.terminal = {
      outcome: 'success',
      resolvedAt: Date.now(),
      resultSessionId: metadata?.resultSessionId ?? result.sessionId,
    };
    this.entry.resolve(result);
    return true;
  }

  resolveFailure(error: Error): boolean {
    return this.rejectTerminal('failure', error);
  }

  resolveInvalid(error: Error): boolean {
    return this.rejectTerminal('invalid', error);
  }

  private rejectTerminal(outcome: Exclude<ConversationRequestTerminalOutcome, 'success'>, error: Error): boolean {
    if (!this.active || this.entry.state === 'resolved') {
      this.active = false;
      return false;
    }

    this.active = false;
    this.entry.state = 'resolved';
    this.entry.terminal = {
      outcome,
      resolvedAt: Date.now(),
      failureCode: this.extractFailureCode(error),
      failureMessage: error.message,
    };
    this.entry.reject(error);
    return true;
  }

  private extractFailureCode(error: Error): string | undefined {
    const value = (error as Error & { code?: unknown }).code;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

export class ConversationRequestRegistry {
  private readonly entries = new Map<string, ConversationRequestRegistryEntry>();

  register(request: ConversationRequest): ConversationRequestRegistration {
    const requestIdentity = this.buildIdentitySnapshot(request);
    const fingerprint = this.buildFingerprint(requestIdentity);
    const existing = this.entries.get(request.conversationRequestId);
    if (existing) {
      if (existing.fingerprint === fingerprint) {
        return {
          kind: 'duplicate',
          promise: existing.promise,
          entry: this.snapshotEntry(existing),
        };
      }

      return {
        kind: 'conflict',
        entry: this.snapshotEntry(existing),
      };
    }

    let resolvePromise: (result: ConversationResult) => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<ConversationResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const entry: ConversationRequestRegistryEntry = {
      ...requestIdentity,
      state: 'pending',
      fingerprint,
      registeredAt: Date.now(),
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
    };

    this.entries.set(request.conversationRequestId, entry);
    return {
      kind: 'registered',
      promise,
      owner: new ConversationRequestResolutionOwner(entry),
      entry: this.snapshotEntry(entry),
    };
  }

  inspect(): ConversationRequestRegistrySnapshot {
    const snapshots = Array.from(this.entries.values())
      .sort((left, right) => left.registeredAt - right.registeredAt)
      .map((entry) => this.snapshotEntry(entry));

    return {
      pending: snapshots.filter((entry) => entry.state === 'pending'),
      recent: snapshots.filter((entry) => entry.state === 'resolved'),
    };
  }

  private buildIdentitySnapshot(request: ConversationRequest): ConversationRequestIdentitySnapshot {
    return {
      conversationRequestId: request.conversationRequestId,
      sessionId: request.sessionId,
      personaId: request.personaId,
      userProfileId: request.userProfileId,
      agentId: request.agentId,
      messageDigest: this.buildMessageDigest(request.message),
      attachmentIdentity: (request.attachments ?? []).map((attachment) => ({
        type: attachment.type,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
        url: attachment.url,
        hasBase64: typeof attachment.base64 === 'string' && attachment.base64.length > 0,
      })),
    };
  }

  private buildFingerprint(identity: ConversationRequestIdentitySnapshot): string {
    return JSON.stringify(identity);
  }

  private buildMessageDigest(message: string): string {
    return createHash('sha1').update(message).digest('hex');
  }

  private snapshotEntry(entry: ConversationRequestRegistryEntry): ConversationRequestRegistryEntrySnapshot {
    return {
      conversationRequestId: entry.conversationRequestId,
      sessionId: entry.sessionId,
      personaId: entry.personaId,
      userProfileId: entry.userProfileId,
      agentId: entry.agentId,
      messageDigest: entry.messageDigest,
      attachmentIdentity: entry.attachmentIdentity.map((attachment) => ({ ...attachment })),
      state: entry.state,
      registeredAt: entry.registeredAt,
      terminal: entry.terminal ? { ...entry.terminal } : undefined,
    };
  }
}
