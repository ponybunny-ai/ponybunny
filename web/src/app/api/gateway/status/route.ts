/**
 * GET /api/gateway/status
 * Returns the current Gateway connection status
 */

import { NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

export async function GET() {
  const gateway = getGatewayConnection();

  try {
    // Try to ping the gateway
    if (!gateway.connected) {
      await gateway.connect();
    }

    await gateway.ping();

    return NextResponse.json({
      connected: true,
      timestamp: Date.now(),
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    });
  }
}
