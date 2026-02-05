/**
 * Session - Represents an authenticated WebSocket connection
 */

import type { Permission, SessionData } from '../types.js';

export class Session implements SessionData {
  readonly id: string;
  readonly publicKey: string;
  readonly permissions: Permission[];
  readonly connectedAt: number;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;

  private subscribedGoals = new Set<string>();
  private subscribedToDebugEvents = false;

  constructor(data: SessionData) {
    this.id = data.id;
    this.publicKey = data.publicKey;
    this.permissions = [...data.permissions];
    this.connectedAt = data.connectedAt;
    this.lastActivityAt = data.lastActivityAt;
    this.metadata = data.metadata;
  }

  hasPermission(permission: Permission): boolean {
    return this.permissions.includes(permission) || this.permissions.includes('admin');
  }

  hasAnyPermission(permissions: Permission[]): boolean {
    return permissions.some(p => this.hasPermission(p));
  }

  hasAllPermissions(permissions: Permission[]): boolean {
    return permissions.every(p => this.hasPermission(p));
  }

  updateActivity(): void {
    this.lastActivityAt = Date.now();
  }

  subscribeToGoal(goalId: string): void {
    this.subscribedGoals.add(goalId);
  }

  unsubscribeFromGoal(goalId: string): void {
    this.subscribedGoals.delete(goalId);
  }

  isSubscribedToGoal(goalId: string): boolean {
    return this.subscribedGoals.has(goalId);
  }

  getSubscribedGoals(): string[] {
    return Array.from(this.subscribedGoals);
  }

  subscribeToDebugEvents(): void {
    this.subscribedToDebugEvents = true;
  }

  unsubscribeFromDebugEvents(): void {
    this.subscribedToDebugEvents = false;
  }

  isSubscribedToDebugEvents(): boolean {
    return this.subscribedToDebugEvents;
  }

  toJSON(): SessionData {
    return {
      id: this.id,
      publicKey: this.publicKey,
      permissions: this.permissions,
      connectedAt: this.connectedAt,
      lastActivityAt: this.lastActivityAt,
      metadata: this.metadata,
    };
  }
}
