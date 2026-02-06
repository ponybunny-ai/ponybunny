/**
 * Escalations API Routes
 *
 * GET /api/escalations - List escalations
 * POST /api/escalations/[escalationId]/respond - Respond to an escalation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

export async function GET(request: NextRequest) {
  const gateway = getGatewayConnection();
  const searchParams = request.nextUrl.searchParams;

  try {
    const params: { goalId?: string; status?: string } = {};

    const goalId = searchParams.get('goalId');
    if (goalId) params.goalId = goalId;

    const status = searchParams.get('status');
    if (status) params.status = status;

    const result = await gateway.getEscalations(params);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Failed to list escalations:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list escalations' },
      { status: 500 }
    );
  }
}
