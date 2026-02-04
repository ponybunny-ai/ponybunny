/**
 * Escalation Handler Module
 *
 * Manages escalations - requests for human intervention.
 */

export type {
  IEscalationHandler,
  EscalationCreateParams,
  EscalationResolveParams,
  EscalationFilter,
  EscalationStats,
} from './types.js';

export {
  EscalationHandler,
  type IEscalationRepository,
} from './escalation-handler.js';
