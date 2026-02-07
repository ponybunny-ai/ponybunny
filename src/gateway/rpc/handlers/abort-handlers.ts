/**
 * Abort Handlers - RPC handlers for abort signal management
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { AbortManager } from '../../../app/execution/abort-manager.js';
import type { AbortScope, IAbortRegistration, IAbortContext, IAbortStats } from '../../../domain/abort/types.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface AbortRegisterParams {
  scope: AbortScope;
  id: string;
  parentId?: string;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface AbortRequestParams {
  scope: AbortScope;
  id: string;
  reason: string;
}

export interface AbortUnregisterParams {
  scope: AbortScope;
  id: string;
}

export interface AbortCheckParams {
  scope: AbortScope;
  id: string;
}

export interface AbortChildrenParams {
  parentScope: AbortScope;
  parentId: string;
  reason: string;
}

export interface AbortListParams {
  scope?: AbortScope;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerAbortHandlers(
  rpcHandler: RpcHandler,
  abortManager: AbortManager
): void {
  // abort.register - Register a new abort controller
  rpcHandler.register<AbortRegisterParams, { registered: boolean }>(
    'abort.register',
    ['write'],
    async (params) => {
      if (!params.scope || !params.id) {
        throw GatewayError.invalidParams('scope and id are required');
      }

      const validScopes: AbortScope[] = ['goal', 'work_item', 'run'];
      if (!validScopes.includes(params.scope)) {
        throw GatewayError.invalidParams(`Invalid scope. Must be one of: ${validScopes.join(', ')}`);
      }

      abortManager.register(params.scope, params.id, {
        parentId: params.parentId,
        timeout: params.timeout,
        metadata: params.metadata,
      });

      return { registered: true };
    }
  );

  // abort.request - Request an abort for a scope
  rpcHandler.register<AbortRequestParams, { abortedCount: number }>(
    'abort.request',
    ['write'],
    async (params, session) => {
      if (!params.scope || !params.id) {
        throw GatewayError.invalidParams('scope and id are required');
      }
      if (!params.reason) {
        throw GatewayError.invalidParams('reason is required');
      }

      const abortedCount = abortManager.abort(
        params.scope,
        params.id,
        params.reason,
        session.publicKey
      );

      return { abortedCount };
    }
  );

  // abort.check - Check if a scope is aborted
  rpcHandler.register<AbortCheckParams, { aborted: boolean; context?: IAbortContext }>(
    'abort.check',
    ['read'],
    async (params) => {
      if (!params.scope || !params.id) {
        throw GatewayError.invalidParams('scope and id are required');
      }

      const aborted = abortManager.isAborted(params.scope, params.id);
      const context = abortManager.getAbortContext(params.scope, params.id);

      return { aborted, context };
    }
  );

  // abort.unregister - Unregister an abort controller
  rpcHandler.register<AbortUnregisterParams, { unregistered: boolean }>(
    'abort.unregister',
    ['write'],
    async (params) => {
      if (!params.scope || !params.id) {
        throw GatewayError.invalidParams('scope and id are required');
      }

      const unregistered = abortManager.unregister(params.scope, params.id);
      return { unregistered };
    }
  );

  // abort.children - Abort all children of a parent
  rpcHandler.register<AbortChildrenParams, { abortedCount: number }>(
    'abort.children',
    ['write'],
    async (params, session) => {
      if (!params.parentScope || !params.parentId) {
        throw GatewayError.invalidParams('parentScope and parentId are required');
      }
      if (!params.reason) {
        throw GatewayError.invalidParams('reason is required');
      }

      const abortedCount = abortManager.abortChildren(
        params.parentScope,
        params.parentId,
        params.reason,
        session.publicKey
      );

      return { abortedCount };
    }
  );

  // abort.list - List active abort registrations
  rpcHandler.register<AbortListParams, { registrations: Array<Omit<IAbortRegistration, 'controller' | 'timeoutId'>> }>(
    'abort.list',
    ['read'],
    async (params) => {
      const registrations = abortManager.getActiveRegistrations(params.scope);

      // Remove non-serializable fields
      const serializable = registrations.map(reg => ({
        id: reg.id,
        scope: reg.scope,
        parentId: reg.parentId,
        createdAt: reg.createdAt,
        timeout: reg.timeout,
        metadata: reg.metadata,
      }));

      return { registrations: serializable };
    }
  );

  // abort.stats - Get abort statistics
  rpcHandler.register<Record<string, never>, { stats: IAbortStats }>(
    'abort.stats',
    ['read'],
    async () => {
      return { stats: abortManager.getStats() };
    }
  );

  // abort.clear - Clear all registrations (admin only)
  rpcHandler.register<Record<string, never>, { success: boolean }>(
    'abort.clear',
    ['write'],
    async () => {
      abortManager.clear();
      return { success: true };
    }
  );
}
