/**
 * Message Router - Routes incoming messages to appropriate handlers
 */

import type { WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import type { RequestFrame, ResponseFrame } from '../types.js';
import { MessageParser } from './message-parser.js';
import { GatewayError } from '../errors.js';
import type { ConnectionManager } from '../connection/connection-manager.js';
import type { RpcHandler } from '../rpc/rpc-handler.js';
import type { AuthManager } from '../auth/auth-manager.js';
import { Session } from '../connection/session.js';

export class MessageRouter {
  private parser: MessageParser;
  private connectionManager: ConnectionManager;
  private rpcHandler: RpcHandler;
  private authManager: AuthManager;

  constructor(
    connectionManager: ConnectionManager,
    rpcHandler: RpcHandler,
    authManager: AuthManager
  ) {
    this.parser = new MessageParser();
    this.connectionManager = connectionManager;
    this.rpcHandler = rpcHandler;
    this.authManager = authManager;
  }

  async handleMessage(ws: WebSocket, data: string | Buffer): Promise<void> {
    const parseResult = this.parser.parse(data);

    if (!parseResult.success || !parseResult.frame) {
      this.sendError(ws, '', parseResult.error || GatewayError.parseError());
      return;
    }

    const frame = parseResult.frame;

    // Only handle request frames from clients
    if (frame.type !== 'req') {
      this.sendError(ws, '', GatewayError.invalidRequest('Only request frames are accepted'));
      return;
    }

    await this.handleRequest(ws, frame);
  }

  private async handleRequest(ws: WebSocket, request: RequestFrame): Promise<void> {
    const { id, method, params } = request;

    try {
      // Check if this is an auth method (allowed without session)
      if (this.isAuthMethod(method)) {
        const result = await this.handleAuthMethod(ws, method, params);
        this.sendResponse(ws, id, result);
        return;
      }

      // Check if this is a public method (allowed without session)
      if (this.isPublicMethod(method)) {
        const result = await this.handlePublicMethod(method);
        this.sendResponse(ws, id, result);
        return;
      }

      // For all other methods, require authentication
      const session = this.connectionManager.getSessionByWebSocket(ws);
      if (!session) {
        throw GatewayError.authRequired();
      }

      // Update activity timestamp
      session.updateActivity();

      // Route to RPC handler
      const result = await this.rpcHandler.handle(method, params, session);
      this.sendResponse(ws, id, result);
    } catch (error) {
      if (error instanceof GatewayError) {
        this.sendError(ws, id, error);
      } else {
        console.error(`[MessageRouter] Unhandled error in ${method}:`, error);
        this.sendError(ws, id, GatewayError.internalError());
      }
    }
  }

  private isAuthMethod(method: string): boolean {
    return method.startsWith('auth.');
  }

  private isPublicMethod(method: string): boolean {
    // Methods that don't require authentication
    return method === 'system.ping' || method === 'system.info';
  }

  private async handlePublicMethod(method: string): Promise<unknown> {
    switch (method) {
      case 'system.ping':
        return { pong: true, timestamp: Date.now() };

      case 'system.info':
        return {
          name: 'PonyBunny Gateway',
          version: '1.0.0',
          timestamp: Date.now(),
        };

      default:
        throw GatewayError.methodNotFound(method);
    }
  }

  private async handleAuthMethod(ws: WebSocket, method: string, params: unknown): Promise<unknown> {
    const connectionId = this.getConnectionId(ws);

    switch (method) {
      case 'auth.hello': {
        const { publicKey } = params as { publicKey: string };
        if (!publicKey) {
          throw GatewayError.invalidParams('publicKey required');
        }
        return this.authManager.handleHello(connectionId, publicKey);
      }

      case 'auth.pair': {
        const { token } = params as { token: string };
        if (!token) {
          throw GatewayError.invalidParams('token required');
        }
        return this.authManager.handlePair(connectionId, token);
      }

      case 'auth.token': {
        // Direct token authentication for admin/debug tools (no challenge-response)
        const { token } = params as { token: string };
        if (!token) {
          throw GatewayError.invalidParams('token required');
        }

        // Validate token directly
        const tokenStore = (this.authManager as any).tokenStore;
        const tokenData = tokenStore.validateToken(token);
        if (!tokenData) {
          throw GatewayError.authFailed('Invalid or expired token');
        }

        // Check for admin permission
        if (!tokenData.permissions.includes('admin')) {
          throw GatewayError.authFailed('Token requires admin permission for direct auth');
        }

        // Create session directly without challenge-response
        const session = {
          id: randomBytes(16).toString('hex'),
          publicKey: `token:${tokenData.id}`,
          permissions: tokenData.permissions,
          connectedAt: Date.now(),
          lastActivityAt: Date.now(),
        };

        this.connectionManager.promoteConnection(ws, session);

        return {
          success: true,
          sessionId: session.id,
          permissions: session.permissions,
        };
      }

      case 'auth.verify': {
        const { signature, publicKey } = params as { signature: string; publicKey?: string };
        if (!signature) {
          throw GatewayError.invalidParams('signature required');
        }

        const result = await this.authManager.handleVerify(connectionId, signature, publicKey);

        if (result.success && result.session) {
          // Promote connection to authenticated session
          this.connectionManager.promoteConnection(ws, result.session);
          return {
            success: true,
            sessionId: result.session.id,
            permissions: result.session.permissions,
          };
        }

        throw GatewayError.authFailed();
      }

      default:
        throw GatewayError.methodNotFound(method);
    }
  }

  private getConnectionId(ws: WebSocket): string {
    // Use the WebSocket object's identity as connection ID
    // In practice, we could use a WeakMap or attach an ID to the socket
    return `conn_${(ws as any)._connectionId || Math.random().toString(36).slice(2)}`;
  }

  private sendResponse(ws: WebSocket, id: string, result: unknown): void {
    const response: ResponseFrame = {
      type: 'res',
      id,
      result,
    };
    this.send(ws, response);
  }

  private sendError(ws: WebSocket, id: string, error: GatewayError): void {
    const response: ResponseFrame = {
      type: 'res',
      id,
      error: error.toRpcError(),
    };
    this.send(ws, response);
  }

  private send(ws: WebSocket, frame: ResponseFrame): void {
    if (ws.readyState === 1) { // OPEN
      try {
        ws.send(JSON.stringify(frame));
      } catch (error) {
        console.error('[MessageRouter] Failed to send:', error);
      }
    }
  }
}
