/**
 * Debug Broadcaster - Broadcasts debug events to subscribed clients via WebSocket.
 *
 * This module integrates the debug instrumentation system with the Gateway,
 * allowing debug events to be sent to clients that have subscribed to debug events.
 */

import { debugEmitter } from '../debug/emitter.js';
import type { DebugEvent } from '../debug/types.js';
import type { ConnectionManager } from './connection/connection-manager.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isPonyBunnyDebugEnabled } from '../infra/config/debug-flags.js';

/**
 * Debug event frame sent to clients.
 */
interface DebugEventFrame {
  type: 'event';
  event: 'debug';
  data: {
    channel: 'debug';
    event: DebugEvent;
    timestamp: number;
  };
}

/**
 * Sets up the debug broadcaster to forward debug events to subscribed WebSocket clients.
 *
 * @param connectionManager - The connection manager for sending messages to clients
 * @param debugMode - Whether debug mode is enabled
 * @returns Cleanup function to stop broadcasting
 */
export function setupDebugBroadcaster(
  connectionManager: ConnectionManager,
  debugMode: boolean
): () => void {
  if (!debugMode) {
    return () => {};
  }

  // Enable debug mode in the emitter
  debugEmitter.enable();

  const outputModes = parseOutputModes(process.env.PONY_BUNNY_DEBUG_OUTPUT);
  const debugLogPath = resolveDebugLogPath(process.env.PONY_BUNNY_DEBUG_LOG_FILE);

  // Handler for debug events
  const handleDebugEvent = (event: DebugEvent): void => {
    const line =
      `[GatewayDebug] ${event.type} source=${event.source} goal=${event.goalId ?? '-'} ` +
      `workItem=${event.workItemId ?? '-'} run=${event.runId ?? '-'} data=${JSON.stringify(event.data)}`;

    if (outputModes.has('console')) {
      console.log(line);
    }

    if (outputModes.has('file') && debugLogPath) {
      try {
        mkdirSync(dirname(debugLogPath), { recursive: true });
        appendFileSync(debugLogPath, `${line}\n`, { encoding: 'utf8' });
      } catch (error) {
        console.error('[DebugBroadcaster] Failed to append debug log file:', error);
      }
    }

    const frame: DebugEventFrame = {
      type: 'event',
      event: 'debug',
      data: {
        channel: 'debug',
        event,
        timestamp: Date.now(),
      },
    };

    // Broadcast to all sessions subscribed to debug events
    // Only admin users can subscribe to debug events
    connectionManager.broadcast(frame, (session) => {
      return session.isSubscribedToDebugEvents() && session.hasPermission('admin');
    });
  };

  // Subscribe to debug events
  debugEmitter.onDebug(handleDebugEvent);

  if (isPonyBunnyDebugEnabled()) console.log('[DebugBroadcaster] Debug mode enabled, broadcasting events to subscribed clients');

  // Return cleanup function
  return () => {
    debugEmitter.offDebug(handleDebugEvent);
    debugEmitter.disable();
    if (isPonyBunnyDebugEnabled()) console.log('[DebugBroadcaster] Debug mode disabled');
  };
}

function parseOutputModes(rawModes: string | undefined): Set<'console' | 'file'> {
  if (!rawModes || rawModes.trim().length === 0) {
    return new Set(['console']);
  }

  const modes = rawModes
    .split(',')
    .map((mode) => mode.trim().toLowerCase())
    .filter((mode) => mode === 'console' || mode === 'file') as Array<'console' | 'file'>;

  if (modes.length === 0) {
    return new Set(['console']);
  }

  return new Set(modes);
}

function resolveDebugLogPath(rawPath: string | undefined): string | null {
  if (!rawPath || rawPath.trim().length === 0) {
    return null;
  }

  return resolve(rawPath);
}

/**
 * Check if debug mode is currently enabled.
 */
export function isDebugModeEnabled(): boolean {
  return debugEmitter.isEnabled();
}
