import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Logger } from '../src/utils/logger.js';

describe('Durable activity logging', () => {
  let testDir: string;

  before(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-activity-log-'));
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('persists redacted MCP events and supports source filtering after recreation', async () => {
    const logger = new Logger(testDir);
    logger.logAction({
      source: 'mcp',
      action: 'read_file',
      params: {
        project: 'temp',
        path: 'src/secret.ts',
        content: 'never persist source content',
        authorization: 'Bearer never-persist',
      },
      status: 'success',
      durationMs: 7,
      resultSummary: 'Read 1 file',
    });
    logger.logAction({
      source: 'rest',
      action: 'workspace_health',
      params: { project: 'temp' },
      status: 'success',
      durationMs: 3,
    });

    const query = (logger as unknown as Record<string, unknown>).queryActivityLogs;
    assert.strictEqual(typeof query, 'function');
    const firstPage = (query as Function).call(logger, { source: 'mcp', limit: 10 });
    assert.strictEqual(firstPage.totalCount, 1);
    assert.strictEqual(firstPage.events[0].source, 'mcp');
    assert.strictEqual(firstPage.events[0].params.project, 'temp');
    assert.strictEqual(firstPage.events[0].params.content, undefined);
    assert.strictEqual(firstPage.events[0].params.authorization, undefined);

    const recreated = new Logger(testDir);
    const recreatedQuery = (recreated as unknown as Record<string, unknown>).queryActivityLogs;
    assert.strictEqual(typeof recreatedQuery, 'function');
    const persisted = (recreatedQuery as Function).call(recreated, { action: 'read_file', limit: 10 });
    assert.strictEqual(persisted.totalCount, 1);
    assert.strictEqual(persisted.events[0].action, 'read_file');
    logger.close();
    recreated.close();
    await assert.doesNotReject(fs.access(path.join(testDir, 'logs', 'activity.sqlite')));
  });

  it('does not fail a tool event when activity storage is unavailable', () => {
    const logger = new Logger(testDir, {
      store: {
        append: () => { throw new Error('disk unavailable'); },
        query: () => ({ events: [], totalCount: 0 }),
        getStats: () => ({ totalActions: 0, errorCount: 0 }),
        close: () => {},
      },
    });

    assert.doesNotThrow(() => logger.logAction({
      source: 'mcp',
      action: 'list_projects',
      params: {},
      status: 'success',
      durationMs: 1,
    }));
    logger.close();
  });
});
