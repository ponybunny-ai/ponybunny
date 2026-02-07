/**
 * Conversation API Route
 * Handles conversation messages via Gateway
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGatewayConnection } from '@/lib/server/gateway-connection';

export async function POST(request: NextRequest) {
  try {
    const gateway = getGatewayConnection();
    if (!gateway || !gateway.connected) {
      return NextResponse.json(
        { error: 'Gateway not connected' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { sessionId, personaId, message, attachments } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    const result = await gateway.request('conversation.message', {
      sessionId,
      personaId,
      message,
      attachments,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Conversation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const gateway = getGatewayConnection();
    if (!gateway || !gateway.connected) {
      return NextResponse.json(
        { error: 'Gateway not connected' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const limit = searchParams.get('limit');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const result = await gateway.request('conversation.history', {
      sessionId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Get conversation history error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gateway = getGatewayConnection();
    if (!gateway || !gateway.connected) {
      return NextResponse.json(
        { error: 'Gateway not connected' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const result = await gateway.request('conversation.end', { sessionId });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] End conversation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
