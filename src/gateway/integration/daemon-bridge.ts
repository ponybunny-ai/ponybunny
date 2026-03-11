/**
 * Historical direct import path kept as a thin compatibility shim.
 *
 * Prefer `./daemon-compatibility.js` for explicit compatibility routing or
 * `./boundaries.js` for the intended live gateway-owned attachment surface.
 */

export {
  DaemonBridge,
  DaemonEventEmitterMixin,
  type IDaemonEventEmitter,
} from './daemon-compatibility.js';
