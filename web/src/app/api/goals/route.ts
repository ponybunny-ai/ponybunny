/**
 * Goals API Routes
 *
 * GET /api/goals - List goals
 * POST /api/goals - Submit a new goal
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

export async function GET(request: NextRequest) {
  const gateway = getGatewayConnection();
  const searchParams = request.nextUrl.searchParams;

  try {
    const params: { status?: string; limit?: number; offset?: number } = {};

    const status = searchParams.get('status');
    if (status) params.status = status;

    const limit = searchParams.get('limit');
    if (limit) params.limit = parseInt(limit, 10);

    const offset = searchParams.get('offset');
    if (offset) params.offset = parseInt(offset, 10);

    const result = await gateway.listGoals(params);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Failed to list goals:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list goals' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gateway = getGatewayConnection();

  try {
    const body = await request.json();

    if (!body.description) {
      return NextResponse.json(
        { error: 'description is required' },
        { status: 400 }
      );
    }

    const goal = await gateway.submitGoal({
      title: body.description,
      description: body.description,
      success_criteria: body.success_criteria || [
        { description: 'Goal completed successfully', verification: 'auto' }
      ],
      context: body.context,
      priority: body.priority,
    });

    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error('[API] Failed to submit goal:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit goal' },
      { status: 500 }
    );
  }
}
