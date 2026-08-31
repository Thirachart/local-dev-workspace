import { describe, it } from 'node:test';
import assert from 'node:assert';
import { withV2Envelope, ToolDefinition } from '../src/tools/middleware.js';
import { ProjectPermissionGuard } from '../src/core/permissions.js';

describe('Task 8: Tool Registration Middleware (withV2Envelope)', () => {
  it('wraps handler and produces ToolResponse<T> with execution time', async () => {
    const wrapped = withV2Envelope({
      name: 'read_file_test',
      capability: 'read',
      mutation: false,
      handler: async (req: { filename: string }) => {
        return { path: req.filename, size: 1024 };
      },
    });

    const res = await wrapped({ filename: 'test.ts', project: 'demo' });
    assert.strictEqual(res.isError, undefined);
    assert.strictEqual(res.content.length, 1);

    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.meta.schemaVersion, '2.0');
    assert.strictEqual(parsed.meta.project, 'demo');
    assert.strictEqual(parsed.data.path, 'test.ts');
  });

  it('catches handler errors and returns structured ToolFailure', async () => {
    const wrapped = withV2Envelope({
      name: 'failing_tool',
      handler: async () => {
        const err: any = new Error('Database locked');
        err.category = 'conflict';
        err.code = 'CONCURRENCY_CONFLICT';
        throw err;
      },
    });

    const res = await wrapped({ project: 'demo' });
    assert.strictEqual(res.isError, true);

    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.category, 'conflict');
    assert.strictEqual(parsed.error.code, 'CONCURRENCY_CONFLICT');
  });

  it('Check 3 (DoD 21): Tool metadata capability is enforced at middleware layer', async () => {
    // Project guard allowing only read
    const guard = new ProjectPermissionGuard(process.cwd(), {
      read: true,
      write: false,
      execute: false,
      git: false,
      network: false,
    });

    const writeTool: ToolDefinition = {
      name: 'write_file_guarded',
      capability: 'write',
      mutation: true,
      handler: async () => ({ written: true }),
    };

    const wrapped = withV2Envelope(writeTool, undefined, guard);
    const res = await wrapped({ path: 'test.txt' });

    assert.strictEqual(res.isError, true);
    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.error.code, 'PERMISSION_DENIED');
  });

  it('Check 4 (DoD 22): rejects unsupported schemaVersion and never silently upgrades', async () => {
    const wrapped = withV2Envelope({
      name: 'version_guarded_tool',
      handler: async () => ({ success: true }),
    });

    const res = await wrapped({ schemaVersion: '1.0' as any });
    assert.strictEqual(res.isError, true);

    const parsed = JSON.parse(res.content[0].text);
    assert.strictEqual(parsed.error.code, 'UNSUPPORTED_SCHEMA_VERSION');
    assert.strictEqual(parsed.error.category, 'validation');
  });
});
