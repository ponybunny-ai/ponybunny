/**
 * Server-Sent Events (SSE) endpoint for real-time Gateway events
 *
 * GET /api/events - Subscribe to Gateway events via SSE
 */

import { getGatewayConnection } from '@/lib/server/gateway-connection';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gateway = getGatewayConnection();

  // Ensure connected
  try {
    if (!gateway.connected) {
      await gateway.connect();
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to connect to Gateway' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const connectEvent = `event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(connectEvent));

      // Subscribe to gateway events
      const unsubscribe = gateway.onEvent((event, data) => {
        const sseMessage = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(sseMessage));
        } catch {
          // Stream closed
        }
      });

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(heartbeat));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Cleanup on close
      return () => {
        unsubscribe();
        clearInterval(heartbeatInterval);
      };
    },
    cancel() {
      // Stream cancelled by client
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
