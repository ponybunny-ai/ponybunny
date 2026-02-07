/**
 * Single Persona API Route
 * Handles getting a specific persona via Gateway
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ personaId: string }> }
) {
  try {
    const gateway = getGatewayConnection();
    if (!gateway || !gateway.connected) {
      return NextResponse.json(
        { error: 'Gateway not connected' },
        { status: 503 }
      );
    }

    const { personaId } = await params;

    const result = await gateway.request('persona.get', { id: personaId });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Get persona error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
