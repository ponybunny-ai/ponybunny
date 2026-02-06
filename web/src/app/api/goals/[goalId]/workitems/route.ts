/**
 * WorkItems API Routes
 *
 * GET /api/goals/[goalId]/workitems - Get work items for a goal
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
    const result = await gateway.getWorkItemsByGoal(goalId);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[API] Failed to get work items for goal ${goalId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get work items' },
      { status: 500 }
    );
  }
}
