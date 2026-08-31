import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCommonRequest, createSuccessResponse, createFailureResponse } from '../src/core/envelope.js';

describe('Task 1: Core Envelope & Error Taxonomy', () => {
  it('rejects unsupported schemaVersion', () => {
    assert.throws(
      () => parseCommonRequest({ schemaVersion: '1.0' }),
      (err: any) => err.code === 'UNSUPPORTED_SCHEMA_VERSION' && err.category === 'validation'
    );
  });

  it('rejects staleBehavior="refresh" for mutation tools', () => {
    assert.throws(
      () => parseCommonRequest({ staleBehavior: 'refresh' }, { isMutation: true }),
      (err: any) => err.code === 'INVALID_STALE_BEHAVIOR' && err.category === 'validation'
    );
  });

  it('accepts staleBehavior="refresh" for read tools', () => {
    const req = parseCommonRequest({ staleBehavior: 'refresh' }, { isMutation: false });
    assert.strictEqual(req.staleBehavior, 'refresh');
  });

  it('formats success envelope with schemaVersion 2.0 and operationId', () => {
    const res = createSuccessResponse({ file: 'app.ts' }, { project: 'demo', durationMs: 15 });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.meta.schemaVersion, '2.0');
    assert.ok(res.meta.operationId.startsWith('op_'));
  });

  it('formats failure envelope with categorized error', () => {
    const res = createFailureResponse({
      category: 'conflict',
      code: 'CONCURRENCY_CONFLICT',
      message: 'File hash mismatch',
    }, { project: 'demo' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.category, 'conflict');
    assert.strictEqual(res.error.code, 'CONCURRENCY_CONFLICT');
  });
});
