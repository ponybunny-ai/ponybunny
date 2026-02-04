/**
 * Message Parser - Parses and validates JSON-RPC frames
 */

import type { Frame, RequestFrame, ResponseFrame, EventFrame } from '../types.js';
import { GatewayError } from '../errors.js';

export interface ParseResult {
  success: boolean;
  frame?: Frame;
  error?: GatewayError;
}

export class MessageParser {
  /**
   * Parse a raw message into a Frame
   */
  parse(data: string | Buffer): ParseResult {
    let json: unknown;

    try {
      const str = typeof data === 'string' ? data : data.toString('utf-8');
      json = JSON.parse(str);
    } catch (error) {
      return {
        success: false,
        error: GatewayError.parseError('Invalid JSON'),
      };
    }

    if (!json || typeof json !== 'object') {
      return {
        success: false,
        error: GatewayError.invalidRequest('Message must be an object'),
      };
    }

    const obj = json as Record<string, unknown>;

    // Validate frame type
    if (!('type' in obj) || typeof obj.type !== 'string') {
      return {
        success: false,
        error: GatewayError.invalidRequest('Missing or invalid "type" field'),
      };
    }

    switch (obj.type) {
      case 'req':
        return this.parseRequest(obj);
      case 'res':
        return this.parseResponse(obj);
      case 'event':
        return this.parseEvent(obj);
      default:
        return {
          success: false,
          error: GatewayError.invalidRequest(`Unknown frame type: ${obj.type}`),
        };
    }
  }

  private parseRequest(obj: Record<string, unknown>): ParseResult {
    // Validate id
    if (!('id' in obj) || typeof obj.id !== 'string' || obj.id.length === 0) {
      return {
        success: false,
        error: GatewayError.invalidRequest('Request must have a non-empty string "id"'),
      };
    }

    // Validate method
    if (!('method' in obj) || typeof obj.method !== 'string' || obj.method.length === 0) {
      return {
        success: false,
        error: GatewayError.invalidRequest('Request must have a non-empty string "method"'),
      };
    }

    const frame: RequestFrame = {
      type: 'req',
      id: obj.id,
      method: obj.method,
    };

    if ('params' in obj) {
      frame.params = obj.params;
    }

    return { success: true, frame };
  }

  private parseResponse(obj: Record<string, unknown>): ParseResult {
    // Validate id
    if (!('id' in obj) || typeof obj.id !== 'string') {
      return {
        success: false,
        error: GatewayError.invalidRequest('Response must have a string "id"'),
      };
    }

    // Must have either result or error
    if (!('result' in obj) && !('error' in obj)) {
      return {
        success: false,
        error: GatewayError.invalidRequest('Response must have "result" or "error"'),
      };
    }

    const frame: ResponseFrame = {
      type: 'res',
      id: obj.id,
    };

    if ('result' in obj) {
      frame.result = obj.result;
    }

    if ('error' in obj) {
      const error = obj.error as Record<string, unknown>;
      if (typeof error?.code !== 'number' || typeof error?.message !== 'string') {
        return {
          success: false,
          error: GatewayError.invalidRequest('Invalid error format'),
        };
      }
      frame.error = {
        code: error.code,
        message: error.message,
        data: error.data,
      };
    }

    return { success: true, frame };
  }

  private parseEvent(obj: Record<string, unknown>): ParseResult {
    // Validate event name
    if (!('event' in obj) || typeof obj.event !== 'string' || obj.event.length === 0) {
      return {
        success: false,
        error: GatewayError.invalidRequest('Event must have a non-empty string "event"'),
      };
    }

    // Validate data exists
    if (!('data' in obj)) {
      return {
        success: false,
        error: GatewayError.invalidRequest('Event must have "data" field'),
      };
    }

    const frame: EventFrame = {
      type: 'event',
      event: obj.event,
      data: obj.data,
    };

    return { success: true, frame };
  }

  /**
   * Serialize a frame to JSON string
   */
  serialize(frame: Frame): string {
    return JSON.stringify(frame);
  }

  /**
   * Create a response frame
   */
  createResponse(id: string, result: unknown): ResponseFrame {
    return {
      type: 'res',
      id,
      result,
    };
  }

  /**
   * Create an error response frame
   */
  createErrorResponse(id: string, error: GatewayError): ResponseFrame {
    return {
      type: 'res',
      id,
      error: error.toRpcError(),
    };
  }

  /**
   * Create an event frame
   */
  createEvent(event: string, data: unknown): EventFrame {
    return {
      type: 'event',
      event,
      data,
    };
  }
}
