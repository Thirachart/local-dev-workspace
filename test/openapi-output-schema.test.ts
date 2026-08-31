import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getOpenApiSpec } from '../src/transports/openapi.js';

describe('OpenAPI output schemas', () => {
  it('declares JSON output schemas for every operation in every public profile', () => {
    for (const profile of ['core', 'agent', 'extension', 'full'] as const) {
      const spec = getOpenApiSpec('http://localhost:4100', profile);

      for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

          const response = (operation as any).responses?.['200'];
          const schema = response?.content?.['application/json']?.schema;
          assert.ok(schema, `${profile} ${method.toUpperCase()} ${path} is missing an output schema`);
        }
      }
    }
  });
});
