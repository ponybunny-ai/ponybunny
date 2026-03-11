/**
 * Intentional public root compatibility surface.
 *
 * These exports preserve older root-level convenience imports for daemon and
 * execution internals without presenting them as the intended live package
 * boundary.
 */

export { ReActIntegration } from './autonomy/react-integration.js';
export { DaemonEventEmitterMixin, type IDaemonEventEmitter } from './autonomy/daemon-event-emitter.js';
