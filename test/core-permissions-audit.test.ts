import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { ProjectPermissionGuard } from '../src/core/permissions.js';
import { AuditLogger } from '../src/core/auditLogger.js';

describe('Task 3: Permissions & Metadata-Only Audit Logger', () => {
  it('AuditLogger stores metadata but strictly omits source content', () => {
    const logger = AuditLogger.getInstance();
    logger.clear();

    const entry = logger.logMutation({
      operationId: 'op_test_123',
      project: 'fin-service',
      tool: 'apply_patch',
      targetPaths: ['src/RefundService.cs'],
      beforeHashes: { 'src/RefundService.cs': 'a1b2c3d4' },
      afterHashes: { 'src/RefundService.cs': 'e5f6g7h8' },
      snapshotBefore: 'snap_1',
      snapshotAfter: 'snap_2',
      durationMs: 42,
    });

    assert.strictEqual(entry.operationId, 'op_test_123');
    assert.strictEqual(entry.tool, 'apply_patch');
    assert.strictEqual((entry as any).content, undefined);
    assert.strictEqual((entry as any).source, undefined);
    assert.strictEqual((entry as any).replacementText, undefined);

    const retrieved = logger.getRecords({ operationId: 'op_test_123' });
    assert.strictEqual(retrieved.length, 1);
    assert.strictEqual(retrieved[0].beforeHashes['src/RefundService.cs'], 'a1b2c3d4');
  });

  it('ProjectPermissionGuard passes when permitted', () => {
    const guard = new ProjectPermissionGuard();
    // Default mock behavior allows actions
    assert.doesNotThrow(() => guard.assertAllowed('read'));
  });
});
