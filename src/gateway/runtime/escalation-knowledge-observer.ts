/**
 * EscalationKnowledgeObserver
 *
 * Bridges escalation resolution events to GlobalKnowledgeService.
 * Records resolution decisions for escalation types that carry
 * reusable knowledge (stuck, risk, validation_failed).
 *
 * Fire-and-forget: errors are logged but never propagated to the event pipeline.
 */

import type { EventBus } from '../events/event-bus.js';
import type { GlobalKnowledgeService } from '../../domain/knowledge/global-knowledge-service.js';
import type { Escalation, EscalationType } from '../../work-order/types/index.js';

// Escalation types that carry knowledge worth recording
const KNOWLEDGE_WORTHY_TYPES: ReadonlySet<EscalationType> = new Set([
  'stuck',
  'risk',
  'validation_failed',
]);

export interface EscalationResolvedEvent {
  escalationId: string;
  goalId: string;
  workItemId: string;
  action: string;
  resolvedBy: string;
}

// Extended repository interface — mirrors the optional-method pattern from escalation-handlers.ts.
// IWorkOrderRepository implementations may provide getEscalation at runtime even though
// the base interface does not declare it. Callers cast when wiring (same as escalation-handlers).
export interface EscalationReadRepository {
  getEscalation?(id: string): Escalation | undefined;
}

export interface EscalationKnowledgeObserverDependencies {
  eventBus: EventBus;
  knowledgeService: GlobalKnowledgeService;
  repository: EscalationReadRepository;
}

export class EscalationKnowledgeObserver {
  private readonly eventBus: EventBus;
  private readonly knowledgeService: GlobalKnowledgeService;
  private readonly repository: EscalationReadRepository;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(dependencies: EscalationKnowledgeObserverDependencies) {
    this.eventBus = dependencies.eventBus;
    this.knowledgeService = dependencies.knowledgeService;
    this.repository = dependencies.repository;
  }

  start(): void {
    if (this.unsubscribers.length > 0) {
      return;
    }

    const unsubscribe = this.eventBus.on<EscalationResolvedEvent>(
      'escalation.resolved',
      (event) => this.handleEscalationResolved(event)
    );
    this.unsubscribers.push(unsubscribe);
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
  }

  private handleEscalationResolved(event: EscalationResolvedEvent): void {
    try {
      // Guard: repository may not support getEscalation
      if (!this.repository.getEscalation) {
        return;
      }

      const escalation = this.repository.getEscalation(event.escalationId);
      if (!escalation) {
        return;
      }

      // Filter: only record knowledge-worthy escalation types
      if (!KNOWLEDGE_WORTHY_TYPES.has(escalation.escalation_type)) {
        return;
      }

      const resolutionContext = escalation.resolution_data
        ? ` — ${JSON.stringify(escalation.resolution_data)}`
        : '';

      this.knowledgeService.record({
        knowledge_type: 'decision',
        content: `Escalation [${escalation.escalation_type}] '${escalation.title}' resolved via ${event.action}${resolutionContext}`,
        source_goal_id: event.goalId,
        domain_tags: ['escalation', escalation.escalation_type],
        confidence: 0.6,
      });
    } catch (error) {
      console.warn('[EscalationKnowledgeObserver] Failed to record escalation knowledge:', error);
    }
  }
}
