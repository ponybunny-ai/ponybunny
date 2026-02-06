/**
 * Single Goal API Routes
 *
 * GET /api/goals/[goalId] - Get goal details
 * DELETE /api/goals/[goalId] - Cancel goal
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

interface RouteParams {
  params: Promise<{ goalId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gateway = getGatewayConnection();
  const { goalId } = await params;

  try {
    const goal = await gateway.getGoal(goalId);
    return NextResponse.json(goal);
  } catch (error) {
    console.error(`[API] Failed to get goal ${goalId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get goal' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gateway = getGatewayConnection();
  const { goalId } = await params;

  try {
    await gateway.cancelGoal(goalId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[API] Failed to cancel goal ${goalId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel goal' },
      { status: 500 }
    );
  }
}
