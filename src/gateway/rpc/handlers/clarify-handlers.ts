/**
 * Clarify Handlers - RPC handlers for goal clarification
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { IClarifyService, IClarificationQuestion, IClarificationResponse, IClarificationState } from '../../../domain/clarify/types.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface ClarifyAnalyzeParams {
  goal: {
    title: string;
    description: string;
    success_criteria: Array<{ description: string }>;
  };
}

export interface ClarifyGenerateParams {
  goal: {
    title: string;
    description: string;
  };
  categories?: Array<'scope' | 'requirements' | 'constraints' | 'dependencies' | 'success_criteria' | 'priority' | 'approach' | 'resources'>;
}

export interface ClarifyInitParams {
  goalId: string;
  questions: IClarificationQuestion[];
}

export interface ClarifyRespondParams {
  goalId: string;
  responses: IClarificationResponse[];
}

export interface ClarifyProcessParams {
  goalId: string;
  responses: IClarificationResponse[];
}

export interface ClarifySkipParams {
  goalId: string;
  reason: string;
}

export interface ClarifyGetStateParams {
  goalId: string;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerClarifyHandlers(
  rpcHandler: RpcHandler,
  clarifyService: IClarifyService
): void {
  // clarify.analyze - Analyze a goal to determine if clarification is needed
  rpcHandler.register<ClarifyAnalyzeParams, {
    needsClarification: boolean;
    confidence: number;
    questions: IClarificationQuestion[];
    reasoning?: string;
    ambiguousAreas?: string[];
  }>(
    'clarify.analyze',
    ['read'],
    async (params) => {
      if (!params.goal) {
        throw GatewayError.invalidParams('goal is required');
      }
      if (!params.goal.title || !params.goal.description) {
        throw GatewayError.invalidParams('goal.title and goal.description are required');
      }

      const goal = {
        title: params.goal.title,
        description: params.goal.description,
        success_criteria: params.goal.success_criteria || [],
      };

      return clarifyService.analyzeGoal(goal);
    }
  );

  // clarify.generate - Generate clarification questions for a goal
  rpcHandler.register<ClarifyGenerateParams, { questions: IClarificationQuestion[] }>(
    'clarify.generate',
    ['read'],
    async (params) => {
      if (!params.goal) {
        throw GatewayError.invalidParams('goal is required');
      }
      if (!params.goal.title || !params.goal.description) {
        throw GatewayError.invalidParams('goal.title and goal.description are required');
      }

      const questions = await clarifyService.generateQuestions(
        params.goal,
        params.categories
      );

      return { questions };
    }
  );

  // clarify.init - Initialize clarification state for a goal
  rpcHandler.register<ClarifyInitParams, { state: IClarificationState }>(
    'clarify.init',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      // Access internal method through the service
      const service = clarifyService as any;
      if (!service.initializeState) {
        throw GatewayError.internalError('ClarifyService does not support initializeState');
      }

      const state = await service.initializeState(params.goalId, params.questions || []);
      return { state };
    }
  );

  // clarify.respond - Add responses to clarification questions
  rpcHandler.register<ClarifyRespondParams, { state: IClarificationState; isComplete: boolean }>(
    'clarify.respond',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }
      if (!params.responses || !Array.isArray(params.responses)) {
        throw GatewayError.invalidParams('responses array is required');
      }

      // Access internal method through the service
      const service = clarifyService as any;
      if (!service.addResponses) {
        throw GatewayError.internalError('ClarifyService does not support addResponses');
      }

      const state = await service.addResponses(params.goalId, params.responses);
      const isComplete = clarifyService.isComplete(state);

      return { state, isComplete };
    }
  );

  // clarify.process - Process responses and get updated goal info
  rpcHandler.register<ClarifyProcessParams, {
    updatedDescription?: string;
    updatedCriteria?: Array<{ description: string }>;
    additionalContext?: Record<string, unknown>;
  }>(
    'clarify.process',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }
      if (!params.responses || !Array.isArray(params.responses)) {
        throw GatewayError.invalidParams('responses array is required');
      }

      return clarifyService.processResponses(params.goalId, params.responses);
    }
  );

  // clarify.skip - Skip clarification for a goal
  rpcHandler.register<ClarifySkipParams, { success: boolean }>(
    'clarify.skip',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }
      if (!params.reason) {
        throw GatewayError.invalidParams('reason is required');
      }

      await clarifyService.skip(params.goalId, params.reason);
      return { success: true };
    }
  );

  // clarify.state - Get clarification state for a goal
  rpcHandler.register<ClarifyGetStateParams, { state: IClarificationState | null }>(
    'clarify.state',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const state = await clarifyService.getState(params.goalId);
      return { state };
    }
  );

  // clarify.isComplete - Check if clarification is complete
  rpcHandler.register<ClarifyGetStateParams, { complete: boolean; state: IClarificationState | null }>(
    'clarify.isComplete',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const state = await clarifyService.getState(params.goalId);
      if (!state) {
        return { complete: false, state: null };
      }

      const complete = clarifyService.isComplete(state);
      return { complete, state };
    }
  );
}
