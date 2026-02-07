/**
 * Personas API Route
 * Handles persona listing and retrieval via Gateway
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

export async function GET() {
  try {
    const gateway = getGatewayConnection();
    if (!gateway || !gateway.connected) {
      return NextResponse.json(
        { error: 'Gateway not connected' },
        { status: 503 }
      );
    }

    const result = await gateway.request('persona.list');

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] List personas error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
