import { NextResponse } from 'next/server';
import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:18789';

interface ResponseFrame {
  type: 'res';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

async function callGatewayRPC<T>(method: string, params: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    const requestId = crypto.randomUUID();
    let timeout: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      ws.close();
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Request timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'req', id: requestId, method, params }));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString()) as ResponseFrame;
        if (frame.type === 'res' && frame.id === requestId) {
          cleanup();
          if (frame.error) reject(new Error(frame.error.message));
          else resolve(frame.result as T);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    ws.on('error', (error) => { cleanup(); reject(error); });
    ws.on('close', () => { cleanup(); reject(new Error('Connection closed')); });
  });
}

export interface DashboardData {
  scheduler: {
    totalGoalsProcessed: number;
    totalWorkItemsCompleted: number;
    totalRunsExecuted: number;
    averageWorkItemDurationMs: number;
    successRate: number;
    currentActiveGoals: number;
    currentActiveWorkItems: number;
  } | null;
  audit: {
    total: number;
    by_action: Record<string, number>;
    by_entity_type: Record<string, number>;
  } | null;
}

export async function GET() {
  try {
    const [schedulerResult, auditResult] = await Promise.allSettled([
      callGatewayRPC<{ metrics: DashboardData['scheduler'] }>('debug.scheduler', {}),
      callGatewayRPC<DashboardData['audit']>('audit.stats', {}),
    ]);

    const data: DashboardData = {
      scheduler: schedulerResult.status === 'fulfilled' ? schedulerResult.value.metrics : null,
      audit: auditResult.status === 'fulfilled' ? auditResult.value : null,
    };

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch dashboard data',
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure the Gateway server is running on ' + GATEWAY_URL,
      },
      { status: 500 }
    );
  }
}
