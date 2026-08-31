import crypto from 'node:crypto';
import { CommonRequest, ToolResponse, ToolFailure, ToolMeta, ErrorCategory, ToolErrorPayload } from './types.js';

export function parseCommonRequest(raw: any, options?: { isMutation?: boolean }): CommonRequest {
  const req = raw || {};

  // 1. Strict schemaVersion check
  if (req.schemaVersion !== undefined && req.schemaVersion !== '2.0') {
    const err: any = new Error(`Unsupported schemaVersion "${req.schemaVersion}". Expected "2.0".`);
    err.category = 'validation';
    err.code = 'UNSUPPORTED_SCHEMA_VERSION';
    throw err;
  }

  // 2. Reject staleBehavior="refresh" on write/mutation tools
  if (options?.isMutation && req.staleBehavior === 'refresh') {
    const err: any = new Error(`staleBehavior "refresh" is prohibited for mutation operations. Use "fail" or omit.`);
    err.category = 'validation';
    err.code = 'INVALID_STALE_BEHAVIOR';
    throw err;
  }

  return {
    schemaVersion: '2.0',
    project: typeof req.project === 'string' ? req.project : undefined,
    cwd: typeof req.cwd === 'string' ? req.cwd : '.',
    expectedSnapshotId: typeof req.expectedSnapshotId === 'string' ? req.expectedSnapshotId : undefined,
    expectedSha256: typeof req.expectedSha256 === 'string' ? req.expectedSha256 : undefined,
    staleBehavior: req.staleBehavior === 'refresh' ? 'refresh' : 'fail',
    detail: ['minimal', 'normal', 'full'].includes(req.detail) ? req.detail : 'normal',
    maxItems: typeof req.maxItems === 'number' ? req.maxItems : 50,
    maxChars: typeof req.maxChars === 'number' ? req.maxChars : 12000,
    includeRaw: Boolean(req.includeRaw),
  };
}

export function createSuccessResponse<T>(data: T, meta: Partial<ToolMeta>): ToolResponse<T> {
  return {
    ok: true,
    data,
    meta: {
      schemaVersion: '2.0',
      operationId: meta.operationId || `op_${crypto.randomBytes(8).toString('hex')}`,
      project: meta.project || 'default',
      cwd: meta.cwd || '.',
      snapshotId: meta.snapshotId,
      snapshotBefore: meta.snapshotBefore,
      snapshotAfter: meta.snapshotAfter,
      durationMs: meta.durationMs ?? 0,
      warnings: meta.warnings || [],
    },
  };
}

export function createFailureResponse(
  error: {
    category: ErrorCategory;
    code: ToolErrorPayload['code'];
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  },
  meta: Partial<ToolMeta>
): ToolFailure {
  return {
    ok: false,
    error: {
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable ?? false,
      details: error.details,
    },
    meta: {
      schemaVersion: '2.0',
      operationId: meta.operationId || `op_${crypto.randomBytes(8).toString('hex')}`,
      project: meta.project || 'default',
      cwd: meta.cwd || '.',
      snapshotId: meta.snapshotId,
      durationMs: meta.durationMs ?? 0,
      warnings: meta.warnings || [],
    },
  };
}
