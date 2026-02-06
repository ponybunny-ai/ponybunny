/**
 * Escalation Response API Route
 *
 * POST /api/escalations/[escalationId]/respond - Respond to an escalation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

interface RouteParams {
  params: Promise<{ escalationId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gateway = getGatewayConnection();
  const { escalationId } = await params;

  try {
    const body = await request.json();

    if (!body.action) {
      return NextResponse.json(
        { error: 'action is required' },
        { status: 400 }
      );
    }

    await gateway.respondToEscalation(escalationId, body.action, body.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[API] Failed to respond to escalation ${escalationId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to respond to escalation' },
      { status: 500 }
    );
  }
}
