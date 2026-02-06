/**
 * Conversation State Machine
 * Manages conversation flow and state transitions
 */

import type {
  ConversationState,
  IStateTransitionEvent,
} from '../../domain/conversation/state-machine-rules.js';
import { canTransitionConversation } from '../../domain/conversation/state-machine-rules.js';
import type { IInputAnalysis, IntentCategory } from '../../domain/conversation/analysis.js';

export interface IConversationStateMachine {
  getCurrentState(): ConversationState;
  transition(to: ConversationState, trigger: string): boolean;
  determineNextState(analysis: IInputAnalysis, hasActiveTask: boolean): ConversationState;
  getTransitionHistory(): IStateTransitionEvent[];
  reset(): void;
}

export type StateChangeCallback = (event: IStateTransitionEvent) => void;

export class ConversationStateMachine implements IConversationStateMachine {
  private currentState: ConversationState = 'idle';
  private transitionHistory: IStateTransitionEvent[] = [];
  private stateChangeCallbacks: StateChangeCallback[] = [];

  constructor(initialState: ConversationState = 'idle') {
    this.currentState = initialState;
  }

  getCurrentState(): ConversationState {
    return this.currentState;
  }

  transition(to: ConversationState, trigger: string): boolean {
    if (!canTransitionConversation(this.currentState, to)) {
      console.warn(
        `[ConversationStateMachine] Invalid transition: ${this.currentState} -> ${to}`
      );
      return false;
    }

    const event: IStateTransitionEvent = {
      from: this.currentState,
      to,
      trigger,
      timestamp: Date.now(),
    };

    this.transitionHistory.push(event);
    this.currentState = to;

    // Notify callbacks
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('[ConversationStateMachine] Callback error:', error);
      }
    }

    return true;
  }

  determineNextState(
    analysis: IInputAnalysis,
    hasActiveTask: boolean
  ): ConversationState {
    const { intent, purpose } = analysis;

    // If there's an active task, check for status inquiries or cancellation
    if (hasActiveTask) {
      if (intent.primary === 'status_inquiry') {
        return 'monitoring';
      }
      if (intent.primary === 'cancellation') {
        return 'reporting';
      }
      // Stay in current state for other inputs during task execution
      if (this.currentState === 'executing' || this.currentState === 'monitoring') {
        return this.currentState;
      }
    }

    // Determine state based on intent
    return this.mapIntentToState(intent.primary, purpose);
  }

  private mapIntentToState(
    intent: IntentCategory,
    purpose: IInputAnalysis['purpose']
  ): ConversationState {
    switch (intent) {
      case 'greeting':
      case 'farewell':
      case 'small_talk':
      case 'feedback':
        return 'chatting';

      case 'task_request':
        if (purpose.missingInfo.length > 0) {
          return 'clarifying';
        }
        return 'executing';

      case 'question':
        // Simple questions stay in chatting, complex ones may need clarification
        return 'chatting';

      case 'status_inquiry':
        return 'monitoring';

      case 'cancellation':
        return 'reporting';

      case 'confirmation':
        // If we were clarifying, now we can execute
        if (this.currentState === 'clarifying') {
          return 'executing';
        }
        return this.currentState;

      case 'clarification':
        return 'clarifying';

      default:
        return this.currentState === 'idle' ? 'chatting' : this.currentState;
    }
  }

  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  getTransitionHistory(): IStateTransitionEvent[] {
    return [...this.transitionHistory];
  }

  reset(): void {
    this.currentState = 'idle';
    this.transitionHistory = [];
  }

  // State-specific helpers
  isExecuting(): boolean {
    return this.currentState === 'executing' || this.currentState === 'monitoring';
  }

  isInteractive(): boolean {
    return ['chatting', 'clarifying', 'reporting'].includes(this.currentState);
  }

  canAcceptNewTask(): boolean {
    return ['idle', 'chatting', 'reporting'].includes(this.currentState);
  }
}
