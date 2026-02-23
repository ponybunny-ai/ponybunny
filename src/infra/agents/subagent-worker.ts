import type { SubagentChildMessage, SubagentInitPayload, SubagentParentMessage } from './subagent-protocol.js';

let state: SubagentInitPayload | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

const sendMessage = (message: SubagentChildMessage): void => {
  if (typeof process.send === 'function') {
    process.send(message);
  }
};

const startHeartbeat = (): void => {
  if (!state) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    if (!state) {
      return;
    }
    sendMessage({
      type: 'heartbeat',
      payload: {
        subagentId: state.subagentId,
        runKey: state.runKey,
        timestamp: Date.now(),
      },
    });
  }, 1000);
};

const stopHeartbeat = (): void => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

const handleInit = (payload: SubagentInitPayload): void => {
  state = payload;
  startHeartbeat();
  sendMessage({
    type: 'ready',
    payload: {
      subagentId: payload.subagentId,
      runKey: payload.runKey,
    },
  });
};

const handleShutdown = (): void => {
  const subagentId = state?.subagentId ?? process.env.PONY_SUBAGENT_ID ?? 'unknown';
  stopHeartbeat();
  sendMessage({
    type: 'shutdown_ack',
    payload: {
      subagentId,
    },
  });
  process.exit(0);
};

process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  const typed = message as SubagentParentMessage;
  if (typed.type === 'init') {
    handleInit(typed.payload);
    return;
  }

  if (typed.type === 'shutdown') {
    handleShutdown();
  }
});

process.on('disconnect', () => {
  handleShutdown();
});
