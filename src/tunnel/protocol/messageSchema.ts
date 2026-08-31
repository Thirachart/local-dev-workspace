import { z } from 'zod';
import { TUNNEL_PROTOCOL_VERSION } from './protocol.js';

export const BaseFrameSchema = z.object({
  type: z.enum([
    'hello',
    'challenge',
    'authenticate',
    'accepted',
    'request',
    'response',
    'heartbeat',
    'disconnect',
    'error',
  ]),
  protocolVersion: z.string().refine((v) => v === TUNNEL_PROTOCOL_VERSION, {
    message: `Unsupported protocol version. Expected ${TUNNEL_PROTOCOL_VERSION}`,
  }),
  id: z.string().min(1, 'Frame id is required'),
  timestamp: z.number().int().positive(),
});

export const HelloFrameSchema = BaseFrameSchema.extend({
  type: z.literal('hello'),
  client: z.string().min(1, 'Client identifier is required'),
  nonce: z.string().min(8, 'Nonce must be at least 8 characters'),
  requestedCapabilities: z.array(z.string()).optional(),
  workspaceHint: z.string().optional(),
});

export const ChallengeFrameSchema = BaseFrameSchema.extend({
  type: z.literal('challenge'),
  challengeId: z.string().min(1),
  salt: z.string().min(8),
});

export const AuthenticateFrameSchema = BaseFrameSchema.extend({
  type: z.literal('authenticate'),
  challengeId: z.string().min(1),
  credential: z.string().min(1),
  workspaceId: z.string().optional(),
});

export const AcceptedFrameSchema = BaseFrameSchema.extend({
  type: z.literal('accepted'),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  capabilityToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
  capabilities: z.array(z.string()),
});

export const RequestFrameSchema = BaseFrameSchema.extend({
  type: z.literal('request'),
  sessionId: z.string().min(1),
  capabilityToken: z.string().min(1),
  tool: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
  expectedSnapshotId: z.string().optional(),
});

export const ResponseFrameSchema = BaseFrameSchema.extend({
  type: z.literal('response'),
  requestId: z.string().min(1),
  success: z.boolean(),
  result: z.unknown().optional(),
  snapshotId: z.string().optional(),
  executionTimeMs: z.number().optional(),
});

export const HeartbeatFrameSchema = BaseFrameSchema.extend({
  type: z.literal('heartbeat'),
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
});

export const DisconnectFrameSchema = BaseFrameSchema.extend({
  type: z.literal('disconnect'),
  sessionId: z.string().optional(),
  reason: z.string().optional(),
});

export const ErrorFrameSchema = BaseFrameSchema.extend({
  type: z.literal('error'),
  requestId: z.string().optional(),
  code: z.string().min(1),
  category: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.unknown()).optional(),
});

export const TunnelFrameSchema = z.discriminatedUnion('type', [
  HelloFrameSchema,
  ChallengeFrameSchema,
  AuthenticateFrameSchema,
  AcceptedFrameSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  HeartbeatFrameSchema,
  DisconnectFrameSchema,
  ErrorFrameSchema,
]);
