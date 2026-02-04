/**
 * RPC Handler - Dispatches RPC calls to registered methods
 */

import { MethodRegistry } from './method-registry.js';
import { Session } from '../connection/session.js';
import { GatewayError } from '../errors.js';
import type { Permission } from '../types.js';

export class RpcHandler {
  private registry: MethodRegistry;

  constructor() {
    this.registry = new MethodRegistry();
  }

  /**
   * Register a method handler
   */
  register<TParams = unknown, TResult = unknown>(
    name: string,
    requiredPermissions: Permission[],
    handler: (params: TParams, session: Session) => Promise<TResult>
  ): void {
    this.registry.register(name, requiredPermissions, handler);
  }

  /**
   * Handle an RPC call
   */
  async handle(method: string, params: unknown, session: Session): Promise<unknown> {
    if (!this.registry.has(method)) {
      throw GatewayError.methodNotFound(method);
    }

    return this.registry.execute(method, params, session);
  }

  /**
   * Get the method registry for direct access
   */
  getRegistry(): MethodRegistry {
    return this.registry;
  }

  /**
   * List all registered methods
   */
  listMethods(): string[] {
    return this.registry.list();
  }

  /**
   * List methods accessible to a session
   */
  listAccessibleMethods(session: Session): string[] {
    return this.registry.listAccessible(session);
  }
}
