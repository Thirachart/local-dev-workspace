import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ContextLedger } from '../src/context/contextLedger.js';
import { DeliveryScopeResolver } from '../src/context/deliveryScope.js';
import { FileService } from '../src/services/fileService.js';
import { GitService } from '../src/services/gitService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { SearchService } from '../src/services/searchService.js';
import { registerTools } from '../src/tools/index.js';
import { Logger } from '../src/utils/logger.js';

type ToolExtra = { sessionId?: string } | undefined;
type RegisteredTool = {
  schema: Record<string, any>;
  handler: (args: any, extra?: ToolExtra) => Promise<any>;
};

function parseToolText(result: any): any {
  assert.notEqual(result?.isError, true, result?.content?.[0]?.text || 'tool failed');
  return JSON.parse(result.content[0].text);
}

describe('Context delivery tools', () => {
  let tempDir: string;
  let projectName: string;
  let tools: Map<string, RegisteredTool>;
  let logger: Logger;
  let projectService: ProjectService;
  let processService: ProcessService;
  let fileService: FileService;
  let searchService: SearchService;
  let gitService: GitService;
  let memoryService: MemoryService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-context-delivery-'));
    projectName = path.basename(tempDir);
    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'alpha\nbeta\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'untouched.txt'), 'untouched\n', 'utf8');

    projectService = new ProjectService(tempDir);
    processService = new ProcessService(tempDir, projectService);
    await processService.runCommand({ command: 'git init -b main', projectName });
    await processService.runCommand({ command: 'git config user.email "test@example.com"', projectName });
    await processService.runCommand({ command: 'git config user.name "Context Delivery Test"', projectName });
    await processService.runCommand({ command: 'git add .', projectName });
    await processService.runCommand({ command: 'git commit -m "initial"', projectName });

    fileService = new FileService(tempDir, projectService);
    searchService = new SearchService(tempDir, projectService);
    gitService = new GitService(tempDir, projectService);
    memoryService = new MemoryService(tempDir);
    logger = new Logger(tempDir);
    tools = new Map();

    const server = {
      tool(
        name: string,
        _description: string,
        schema: Record<string, any>,
        handler: (args: any, extra?: ToolExtra) => Promise<any>,
      ) {
        tools.set(name, { schema, handler });
      },
    };

    registerTools(server as any, {
      fileService,
      searchService,
      processService,
      gitService,
      projectService,
      memoryService,
      deliveryScopeResolver: new DeliveryScopeResolver('http', 'test-instance'),
      logger,
    });
  });

  after(async () => {
    logger.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps context_delivery_status resource schema descriptions aligned with read_file', () => {
    const readSchema = tools.get('read_file')!.schema;
    const statusSchema = tools.get('context_delivery_status')!.schema;
    for (const field of ['project', 'path', 'start_line', 'end_line', 'cwd']) {
      assert.equal(statusSchema[field]?.description, readSchema[field]?.description, `${field} description differs`);
    }
  });

  it('tracks full delivery, unchanged reuse, and later hash confirmation per session', async () => {
    const readFile = tools.get('read_file')!.handler;
    const status = tools.get('context_delivery_status')!.handler;

    const first = await readFile({ project: projectName, path: 'sample.txt' }, { sessionId: 'session-a' });
    const firstPayload = parseToolText(first);
    assert.equal(firstPayload.delivery, 'full');
    assert.match(firstPayload.deliveryId, /^del_/);
    assert.equal(firstPayload.deliveryId.includes(projectName), false);
    assert.equal(firstPayload.deliveryId.includes(tempDir), false);
    assert.equal(firstPayload.deliveryId.includes('sample.txt'), false);
    assert.equal(firstPayload.deliveryId.includes('alpha'), false);

    const beforeAck = await status({ project: projectName, path: 'sample.txt' }, { sessionId: 'session-a' });
    const beforeAckPayload = parseToolText(beforeAck);
    assert.equal(beforeAckPayload.status, 'delivered_unconfirmed');
    assert.equal(beforeAckPayload.evidence.modelConsumed, 'not_observable');
    assert.equal(JSON.stringify(beforeAckPayload).includes('alpha\nbeta'), false);
    const statusLogs = logger.queryActivityLogs({ action: 'context_delivery_status', limit: 10 });
    assert.ok(statusLogs.events.length > 0);
    assert.equal(JSON.stringify(statusLogs.events).includes('alpha\nbeta'), false);

    const second = await readFile(
      { project: projectName, path: 'sample.txt', known_sha256: firstPayload.sha256 },
      { sessionId: 'session-a' },
    );
    const secondPayload = parseToolText(second);
    assert.equal(secondPayload.delivery, 'unchanged');
    assert.equal(secondPayload.deliveryId, firstPayload.deliveryId);
    assert.equal('content' in secondPayload, false);

    const afterAck = await status({ project: projectName, path: 'sample.txt' }, { sessionId: 'session-a' });
    assert.equal(parseToolText(afterAck).status, 'delivered_hash_confirmed');

    const otherSession = await status({ project: projectName, path: 'sample.txt' }, { sessionId: 'session-b' });
    assert.equal(parseToolText(otherSession).status, 'never_delivered');
  });

  it('reports content_changed before the next read, then sends a diff with a new id', async () => {
    const readFile = tools.get('read_file')!.handler;
    const status = tools.get('context_delivery_status')!.handler;
    const first = parseToolText(await readFile(
      { project: projectName, path: 'sample.txt' },
      { sessionId: 'session-change' },
    ));

    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'alpha\ngamma\n', 'utf8');

    const changedStatus = parseToolText(await status(
      { project: projectName, path: 'sample.txt' },
      { sessionId: 'session-change' },
    ));
    assert.equal(changedStatus.status, 'content_changed');
    assert.equal(changedStatus.recommendedDelivery, 'diff');

    const changedRead = parseToolText(await readFile(
      { project: projectName, path: 'sample.txt', known_sha256: first.sha256 },
      { sessionId: 'session-change' },
    ));
    assert.equal(changedRead.delivery, 'diff');
    assert.notEqual(changedRead.deliveryId, first.deliveryId);
    assert.equal('content' in changedRead, false);
    assert.match(changedRead.patch || '', /gamma/);
  });

  it('does not create delivery history for failed reads and treats missing HTTP session identity as unknown', async () => {
    const readFile = tools.get('read_file')!.handler;
    const status = tools.get('context_delivery_status')!.handler;

    const failed = await readFile(
      { project: projectName, path: 'missing.txt' },
      { sessionId: 'session-failed' },
    );
    assert.equal(failed.isError, true);

    const untouched = parseToolText(await status(
      { project: projectName, path: 'untouched.txt' },
      { sessionId: 'session-failed' },
    ));
    assert.equal(untouched.status, 'never_delivered');

    const unknown = parseToolText(await status(
      { project: projectName, path: 'sample.txt' },
      undefined,
    ));
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.knowledgeScope, 'unknown');
    assert.equal(unknown.resendRequired, null);
  });

  it('falls back to full with base_not_cached when the diff base was evicted', async () => {
    await fs.writeFile(path.join(tempDir, 'eviction.txt'), 'eviction-base\n', 'utf8');
    const smallTools = new Map<string, RegisteredTool>();
    const server = {
      tool(
        name: string,
        _description: string,
        schema: Record<string, any>,
        handler: (args: any, extra?: ToolExtra) => Promise<any>,
      ) {
        smallTools.set(name, { schema, handler });
      },
    };

    registerTools(server as any, {
      fileService,
      searchService,
      processService,
      gitService,
      projectService,
      memoryService,
      deliveryScopeResolver: new DeliveryScopeResolver('http', 'eviction-instance'),
      contextLedger: new ContextLedger({ maxContentBytes: 1 }),
      logger,
    });

    const readFile = smallTools.get('read_file')!.handler;
    const first = parseToolText(await readFile(
      { project: projectName, path: 'eviction.txt' },
      { sessionId: 'session-evict' },
    ));
    assert.equal(first.delivery, 'full');

    await fs.writeFile(path.join(tempDir, 'eviction.txt'), 'eviction-next\n', 'utf8');
    const second = parseToolText(await readFile(
      { project: projectName, path: 'eviction.txt', known_sha256: first.sha256 },
      { sessionId: 'session-evict' },
    ));

    assert.equal(second.delivery, 'full');
    assert.equal(second.deliveryFallback, 'base_not_cached');
    assert.equal(second.content, 'eviction-next\n');
  });
});
