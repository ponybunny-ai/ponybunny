/**
 * Intentional public root compatibility surface.
 *
 * These exports preserve older root-level convenience imports for daemon and
 * execution internals without presenting them as the intended live package
 * boundary.
 */

export { ReActIntegration } from './runtime/react/react-integration.js';
export { DaemonEventEmitterMixin, type IDaemonEventEmitter } from './runtime/events/daemon-event-emitter.js';
