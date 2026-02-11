import { NextResponse } from 'next/server';
import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:18789';

interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: 'res';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
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
      const frame: RequestFrame = {
        type: 'req',
        id: requestId,
        method,
        params,
      };
      ws.send(JSON.stringify(frame));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString()) as ResponseFrame;
        
        if (frame.type === 'res' && frame.id === requestId) {
          cleanup();
          
          if (frame.error) {
            reject(new Error(frame.error.message));
          } else {
            resolve(frame.result as T);
          }
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    ws.on('error', (error) => {
      cleanup();
      reject(error);
    });

    ws.on('close', () => {
      cleanup();
      reject(new Error('Connection closed'));
    });
  });
}

export async function GET() {
  try {
    const status = await callGatewayRPC('system.status', {});
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to get system status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get system status', 
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure the Gateway server is running on ' + GATEWAY_URL
      },
      { status: 500 }
    );
  }
}
