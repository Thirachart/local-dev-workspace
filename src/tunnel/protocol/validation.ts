import crypto from 'node:crypto';
import { TunnelFrameSchema } from './messageSchema.js';
import type { AnyTunnelFrame, ErrorFrame, ResponseFrame } from './protocol.js';
import { TUNNEL_PROTOCOL_VERSION } from './protocol.js';
import { TunnelError } from './errors.js';

export function parseTunnelFrame(raw: unknown): AnyTunnelFrame {
  let parsedJson = raw;
  if (typeof raw === 'string') {
    try {
      parsedJson = JSON.parse(raw);
    } catch (err: any) {
      throw new TunnelError('INVALID_JSON', 'protocol', `Failed to parse frame JSON: ${err.message}`);
    }
  }

  const result = TunnelFrameSchema.safeParse(parsedJson);
  if (!result.success) {
    const formatted = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new TunnelError('FRAME_VALIDATION_ERROR', 'validation', `Invalid tunnel frame: ${formatted}`);
  }

  return result.data as AnyTunnelFrame;
}

export function serializeTunnelFrame(frame: AnyTunnelFrame): string {
  return JSON.stringify(frame);
}

export function createErrorFrame(code: string, category: string, message: string, requestId?: string, details?: Record<string, unknown>): ErrorFrame {
  return {
    type: 'error',
    protocolVersion: TUNNEL_PROTOCOL_VERSION,
    id: `err_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: Date.now(),
    requestId,
    code,
    category,
    message,
    details,
  };
}

export function createResponseFrame(requestId: string, success: boolean, result?: unknown, snapshotId?: string, executionTimeMs?: number): ResponseFrame {
  return {
    type: 'response',
    protocolVersion: TUNNEL_PROTOCOL_VERSION,
    id: `resp_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: Date.now(),
    requestId,
    success,
    result,
    snapshotId,
    executionTimeMs,
  };
}
