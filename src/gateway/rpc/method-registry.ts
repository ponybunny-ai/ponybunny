/**
 * Method Registry - Registers and manages RPC method handlers
 */

import type { Permission } from '../types.js';
import { Session } from '../connection/session.js';
import { GatewayError } from '../errors.js';

// Handler type that uses the Session class (not interface)
export type MethodHandler<TParams = unknown, TResult = unknown> =
  (params: TParams, session: Session) => Promise<TResult>;

export interface MethodDefinition {
  name: string;
  requiredPermissions: Permission[];
  handler: MethodHandler;
}

export class MethodRegistry {
  private methods = new Map<string, MethodDefinition>();

  /**
   * Register a method handler
   */
  register<TParams = unknown, TResult = unknown>(
    name: string,
    requiredPermissions: Permission[],
    handler: MethodHandler<TParams, TResult>
  ): void {
    if (this.methods.has(name)) {
      throw new Error(`Method '${name}' is already registered`);
    }

    this.methods.set(name, {
      name,
      requiredPermissions,
      handler: handler as MethodHandler,
    });
  }

  /**
   * Unregister a method
   */
  unregister(name: string): boolean {
    return this.methods.delete(name);
  }

  /**
   * Get a method definition
   */
  get(name: string): MethodDefinition | undefined {
    return this.methods.get(name);
  }

  /**
   * Check if a method exists
   */
  has(name: string): boolean {
    return this.methods.has(name);
  }

  /**
   * Check if session has permission to call method
   */
  checkPermission(name: string, session: Session): void {
    const method = this.methods.get(name);
    if (!method) {
      throw GatewayError.methodNotFound(name);
    }

    if (method.requiredPermissions.length === 0) {
      return; // No permissions required
    }

    if (!session.hasAnyPermission(method.requiredPermissions)) {
      throw GatewayError.permissionDenied(method.requiredPermissions.join(' or '));
    }
  }

  /**
   * Execute a method
   */
  async execute(name: string, params: unknown, session: Session): Promise<unknown> {
    const method = this.methods.get(name);
    if (!method) {
      throw GatewayError.methodNotFound(name);
    }

    this.checkPermission(name, session);

    return method.handler(params, session);
  }

  /**
   * List all registered methods
   */
  list(): string[] {
    return Array.from(this.methods.keys());
  }

  /**
   * List methods accessible to a session
   */
  listAccessible(session: Session): string[] {
    const accessible: string[] = [];
    for (const [name, method] of this.methods) {
      if (
        method.requiredPermissions.length === 0 ||
        session.hasAnyPermission(method.requiredPermissions)
      ) {
        accessible.push(name);
      }
    }
    return accessible;
  }

  /**
   * Get method info for documentation
   */
  getMethodInfo(): Array<{ name: string; permissions: Permission[] }> {
    return Array.from(this.methods.values()).map(m => ({
      name: m.name,
      permissions: m.requiredPermissions,
    }));
  }
}
