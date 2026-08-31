import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getOpenApiSpec } from '../src/transports/openapi.js';

describe('OpenAPI 30-Operation Limit for ChatGPT Custom GPT Actions', () => {
  const hostUrl = 'https://demo-tunnel.ngrok-free.app';

  it('Core Profile (default) MUST have <= 30 operations for ChatGPT Actions compatibility', () => {
    const spec = getOpenApiSpec(hostUrl, 'core');
    const pathKeys = Object.keys(spec.paths);

    assert.ok(pathKeys.length <= 30, `Core spec has ${pathKeys.length} operations, which exceeds 30!`);
    assert.strictEqual(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/api/list_projects']);
    assert.ok(spec.paths['/api/read_file']);
    assert.ok(spec.paths['/api/write_file']);
    assert.ok(spec.paths['/api/apply_patch']);
    assert.ok(spec.paths['/api/run_command']);
    assert.ok(spec.paths['/api/git_status']);
    assert.ok(spec.paths['/api/git_commit']);
  });

  it('Full Profile contains all operations', () => {
    const spec = getOpenApiSpec(hostUrl, 'full');
    const pathKeys = Object.keys(spec.paths);

    const corePaths = Object.keys(getOpenApiSpec(hostUrl, 'core').paths);
    assert.ok(pathKeys.length >= corePaths.length, 'Full profile must contain at least every Core operation');
    assert.strictEqual(pathKeys.some((pathKey) => pathKey.includes('linear_')), false);
  });

  it('All operationIds across all profiles are strictly unique', () => {
    const spec = getOpenApiSpec(hostUrl, 'full');
    const operationIds = new Set<string>();

    for (const [pathKey, pathObj] of Object.entries(spec.paths)) {
      const op = (pathObj as any).post;
      assert.ok(op, `Path ${pathKey} must have a POST operation`);
      assert.ok(op.operationId, `Path ${pathKey} must have an operationId`);
      assert.strictEqual(
        operationIds.has(op.operationId),
        false,
        `Duplicate operationId "${op.operationId}" found on path ${pathKey}`
      );
      operationIds.add(op.operationId);
    }
  });
});
