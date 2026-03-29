import { EventBus } from '../../../src/gateway/events/event-bus.js';
import {
  EscalationKnowledgeObserver,
  type EscalationResolvedEvent,
  type EscalationReadRepository,
} from '../../../src/gateway/runtime/escalation-knowledge-observer.js';
import type { GlobalKnowledgeService } from '../../../src/domain/knowledge/global-knowledge-service.js';
import type { Escalation } from '../../../src/work-order/types/index.js';
import type { ILogger } from '../../../src/infra/observability/logger.js';

function makeEscalation(overrides: Partial<Escalation> = {}): Escalation {
  return {
    id: 'esc-1',
    created_at: Date.now(),
    work_item_id: 'wi-1',
    goal_id: 'goal-1',
    escalation_type: 'stuck',
    severity: 'medium',
    status: 'resolved',
    title: 'Agent is stuck on dependency resolution',
    description: 'Cannot resolve npm packages',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EscalationResolvedEvent> = {}): EscalationResolvedEvent {
  return {
    escalationId: 'esc-1',
    goalId: 'goal-1',
    workItemId: 'wi-1',
    action: 'retry',
    resolvedBy: 'user-key',
    ...overrides,
  };
}

describe('EscalationKnowledgeObserver', () => {
  let eventBus: EventBus;
  let knowledgeService: jest.Mocked<Pick<GlobalKnowledgeService, 'record'>>;
  let repository: EscalationReadRepository;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    eventBus = new EventBus();
    knowledgeService = {
      record: jest.fn(),
    };
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    } as unknown as jest.Mocked<ILogger>;
  });

  function createObserver(repo?: EscalationReadRepository) {
    return new EscalationKnowledgeObserver({
      eventBus,
      knowledgeService: knowledgeService as unknown as GlobalKnowledgeService,
      repository: repo ?? repository,
      logger: mockLogger,
    });
  }

  it('records knowledge when a stuck escalation is resolved', () => {
    const escalation = makeEscalation({ escalation_type: 'stuck' });
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).toHaveBeenCalledTimes(1);
    expect(knowledgeService.record).toHaveBeenCalledWith({
      knowledge_type: 'decision',
      content: "Escalation [stuck] 'Agent is stuck on dependency resolution' resolved via retry",
      source_goal_id: 'goal-1',
      domain_tags: ['escalation', 'stuck'],
      confidence: 0.6,
    });
  });

  it('records knowledge when a risk escalation is resolved', () => {
    const escalation = makeEscalation({ escalation_type: 'risk', title: 'High risk deployment' });
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent({ action: 'skip' }));

    expect(knowledgeService.record).toHaveBeenCalledTimes(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Escalation [risk] 'High risk deployment' resolved via skip",
        domain_tags: ['escalation', 'risk'],
      })
    );
  });

  it('records knowledge when a validation_failed escalation is resolved', () => {
    const escalation = makeEscalation({ escalation_type: 'validation_failed', title: 'Tests failing' });
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent({ action: 'alternative_approach' }));

    expect(knowledgeService.record).toHaveBeenCalledTimes(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Escalation [validation_failed] 'Tests failing' resolved via alternative_approach",
        domain_tags: ['escalation', 'validation_failed'],
      })
    );
  });

  it('does NOT record knowledge for ambiguous escalation type', () => {
    const escalation = makeEscalation({ escalation_type: 'ambiguous' });
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).not.toHaveBeenCalled();
  });

  it('does NOT record knowledge for credential escalation type', () => {
    const escalation = makeEscalation({ escalation_type: 'credential' });
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).not.toHaveBeenCalled();
  });

  it('handles missing escalation gracefully (getEscalation returns undefined)', () => {
    repository = { getEscalation: () => undefined };
    const observer = createObserver();
    observer.start();

    // Should not throw
    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).not.toHaveBeenCalled();
  });

  it('handles repository without getEscalation method', () => {
    repository = {};
    const observer = createObserver();
    observer.start();

    // Should not throw
    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).not.toHaveBeenCalled();
  });

  it('stops processing events after stop() is called', () => {
    const escalation = makeEscalation();
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent());
    expect(knowledgeService.record).toHaveBeenCalledTimes(1);

    observer.stop();

    eventBus.emit('escalation.resolved', makeEvent());
    // Should still be 1 — no new call after stop
    expect(knowledgeService.record).toHaveBeenCalledTimes(1);
  });

  it('does not double-subscribe on repeated start()', () => {
    const escalation = makeEscalation();
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();
    observer.start(); // should be idempotent

    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).toHaveBeenCalledTimes(1);
  });

  it('does not propagate errors from knowledgeService.record()', () => {
    const escalation = makeEscalation();
    repository = { getEscalation: () => escalation };
    knowledgeService.record.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    const observer = createObserver();
    observer.start();

    // Should not throw
    expect(() => {
      eventBus.emit('escalation.resolved', makeEvent());
    }).not.toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: 'escalation_knowledge_record_failed', error: 'DB write failed' },
      'Failed to record escalation knowledge'
    );
  });

  it('includes resolution_data in content when present', () => {
    const escalation = makeEscalation({
      resolution_data: { suggestion: 'use yarn instead' },
    });
    repository = { getEscalation: () => escalation };
    const observer = createObserver();
    observer.start();

    eventBus.emit('escalation.resolved', makeEvent());

    expect(knowledgeService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('{"suggestion":"use yarn instead"}'),
      })
    );
  });
});
