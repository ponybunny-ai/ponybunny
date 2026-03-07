#!/usr/bin/env node

import { WebSocket } from 'ws';

function parseArgs(argv) {
  const args = {
    url: 'ws://127.0.0.1:18789',
    timeoutMs: 15 * 60 * 1000,
    pollIntervalMs: 1000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--url' && typeof value === 'string') {
      args.url = value;
      i += 1;
      continue;
    }
    if (key === '--timeout-ms' && typeof value === 'string') {
      args.timeoutMs = Number.parseInt(value, 10);
      i += 1;
      continue;
    }
    if (key === '--poll-ms' && typeof value === 'string') {
      args.pollIntervalMs = Number.parseInt(value, 10);
      i += 1;
    }
  }

  return args;
}

async function connect(url) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const onError = (error) => {
      ws.removeAllListeners();
      reject(error);
    };
    ws.once('error', onError);
    ws.once('open', () => {
      ws.off('error', onError);
      resolve(ws);
    });
  });
}

function createRequester(ws) {
  let seq = 0;
  const pending = new Map();

  ws.on('message', (chunk) => {
    let frame;
    try {
      frame = JSON.parse(chunk.toString());
    } catch {
      return;
    }

    if (!frame || frame.type !== 'res' || typeof frame.id !== 'string') {
      return;
    }

    const resolver = pending.get(frame.id);
    if (!resolver) {
      return;
    }
    pending.delete(frame.id);

    if (frame.error) {
      resolver.reject(new Error(frame.error.message || 'RPC error'));
      return;
    }
    resolver.resolve(frame.result);
  });

  return {
    async request(method, params) {
      const id = `rollback-drill-${Date.now()}-${seq}`;
      seq += 1;
      const payload = {
        type: 'req',
        id,
        method,
        params,
      };

      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(payload), (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    },
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const ws = await connect(args.url);
  const rpc = createRequester(ws);

  try {
    const before = await rpc.request('system.runtime.rollout.status', {});

    await rpc.request('system.runtime.rollout.update', {
      shadowModeEnabled: false,
      canaryPercent: 10,
      lanePercents: {
        dryRun: 10,
        compile: 0,
        replay: 0,
      },
      rollbackOnFailure: true,
    });

    const mutated = await rpc.request('system.runtime.rollout.status', {});

    await rpc.request('system.runtime.rollout.update', {
      rollbackToLegacy: true,
    });

    let final = await rpc.request('system.runtime.rollout.status', {});
    while (final && final.mode !== 'legacy' && Date.now() - startedAt < args.timeoutMs) {
      await sleep(args.pollIntervalMs);
      final = await rpc.request('system.runtime.rollout.status', {});
    }

    const durationMs = Date.now() - startedAt;
    const recovered = Boolean(final && final.mode === 'legacy');
    const result = {
      timestamp: Date.now(),
      url: args.url,
      durationMs,
      recoveredWithin15Minutes: recovered && durationMs <= 15 * 60 * 1000,
      beforeMode: before?.mode ?? 'unknown',
      mutatedMode: mutated?.mode ?? 'unknown',
      finalMode: final?.mode ?? 'unknown',
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.recoveredWithin15Minutes) {
      process.exitCode = 2;
    }
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  process.stderr.write(`[rollback-drill] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
