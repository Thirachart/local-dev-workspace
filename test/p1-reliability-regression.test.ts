import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FileService } from '../src/services/fileService.js';
import { GitService } from '../src/services/gitService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { SearchService } from '../src/services/searchService.js';
import { TestRunnerService } from '../src/services/testRunnerService.js';
import { registerTools } from '../src/tools/index.js';
import { Logger } from '../src/utils/logger.js';

const tempPaths: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  while (tempPaths.length > 0) {
    const dir = tempPaths.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('P1 reliability: task and test reporting', () => {
  it('freezes completed task duration and supports bounded task filters', async () => {
    const root = await makeTemp('chat-dev-p1-process-');
    const service = new ProcessService(root);
    const started = await service.runCommand({
      command: 'node -e "setTimeout(() => {}, 60)"',
      isDaemon: true,
    });
    assert.ok(started.taskId);

    let first = service.getTaskStatus(started.taskId!);
    const deadline = Date.now() + 3000;
    while (first.task?.status === 'running' && Date.now() < deadline) {
      await sleep(50);
      first = service.getTaskStatus(started.taskId!);
    }
    assert.equal(first.found, true);
    assert.equal(first.task?.status, 'completed');
    assert.equal(first.task?.processAlive, false);
    assert.ok(first.task?.finishedAt);
    const frozenDuration = first.task!.durationMs;

    await sleep(100);
    const second = service.getTaskStatus(started.taskId!);
    assert.equal(second.task?.durationMs, frozenDuration);
    assert.equal(second.task?.runningTimeMs, frozenDuration);

    const completed = service.listTasks(undefined, { status: 'completed', limit: 1, sort: 'newest' });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].id, started.taskId);
    assert.equal(completed[0].durationMs, frozenDuration);
  });

  it('reports command success without inventing zero tests when output is not parseable', async () => {
    const root = await makeTemp('chat-dev-p1-tests-');
    const fakeProcess = {
      runCommand: async () => ({
        taskId: 'fake',
        isDaemon: false,
        stdout: 'custom checks completed successfully\n',
        stderr: '',
        exitCode: 0,
        status: 'completed',
        durationMs: 1,
        cwd: '.',
      }),
    } as any;
    const runner = new TestRunnerService(fakeProcess, root);
    const result = await runner.runTests({ customCommand: 'custom-check' });

    assert.equal(result.status, 'passed');
    assert.equal(result.commandPassed, true);
    assert.equal(result.testCountKnown, false);
    assert.equal(result.total, 0);
    assert.equal(result.parserConfidence, 'low');
    assert.match(result.summary, /test count unavailable/i);
    assert.doesNotMatch(result.summary, /0 passed/i);
  });

  it('uses Node TAP summary counts and distinguishes a known zero-test run', async () => {
    const root = await makeTemp('chat-dev-p1-tap-');
    const runner = new TestRunnerService({} as any, root);
    const parsed = runner.parseOutput('# tests 150\n# pass 149\n# fail 1\n# skipped 0\n', 'node:test');
    assert.equal(parsed.countKnown, true);
    assert.equal(parsed.passed, 149);
    assert.equal(parsed.failed, 1);

    const zero = runner.parseOutput('# tests 0\n# pass 0\n# fail 0\n# skipped 0\n', 'node:test');
    assert.equal(zero.countKnown, true);
    assert.equal(zero.passed + zero.failed + zero.skipped, 0);
  });
});

describe('P1 reliability: project registry safety', () => {
  it('separates registering an existing directory from creating a new project', async () => {
    const root = await makeTemp('chat-dev-p1-registry-');
    const service = new ProjectService(root);
    const missing = path.join(root, 'typo-project');

    await assert.rejects(
      service.addProject({ name: 'typo-register', path: missing }),
      (err: any) => err?.code === 'PROJECT_PATH_NOT_FOUND',
    );
    await assert.rejects(fs.stat(missing));

    const createdPath = path.join(root, 'created-project');
    const created = await service.createProject({ name: 'created-project', path: createdPath });
    assert.equal(created.name, 'created-project');
    assert.equal((await fs.stat(createdPath)).isDirectory(), true);

    const listed = service.listProjects('global', true).projects.find((p) => p.name === 'created-project');
    assert.equal(listed?.pathExists, true);
    assert.ok(listed?.lastUsedAt);

    await assert.rejects(
      service.createProject({ name: 'duplicate-path', path: createdPath }),
      (err: any) => err?.code === 'PROJECT_PATH_ALREADY_EXISTS',
    );

    const missingUpdate = path.join(root, 'missing-update-target');
    await assert.rejects(
      service.updateProject(created.id, { path: missingUpdate }),
      (err: any) => err?.code === 'PROJECT_PATH_NOT_FOUND',
    );
    await assert.rejects(fs.stat(missingUpdate));

    await assert.rejects(
      service.updateProject(created.id, { path: root }),
      (err: any) => err?.code === 'PROJECT_PATH_CONFLICT',
    );
    await assert.rejects(
      service.updateProject(created.id, { name: path.basename(root) }),
      (err: any) => err?.code === 'PROJECT_NAME_CONFLICT',
    );
  });
});

describe('P1 reliability: public error contract and process compatibility', () => {
  it('adds a structured error envelope while keeping text error compatibility', async () => {
    const root = await makeTemp('chat-dev-p1-tools-');
    const state = await makeTemp('chat-dev-p1-state-');
    const logs = await makeTemp('chat-dev-p1-logs-');
    const projectService = new ProjectService(root);
    const processService = new ProcessService(root, projectService);
    const tools = new Map<string, { description: string; handler: (args: any) => Promise<any> }>();
    const logger = new Logger(logs);

    const server = {
      tool(name: string, description: string, _schema: Record<string, any>, handler: (args: any) => Promise<any>) {
        tools.set(name, { description, handler });
      },
    };

    registerTools(server as any, {
      fileService: new FileService(root, projectService),
      searchService: new SearchService(root, projectService),
      processService,
      gitService: new GitService(root, projectService),
      projectService,
      memoryService: new MemoryService(state),
      logger,
    });

    try {
      const createResult = await tools.get('create_project')!.handler({
        name: 'existing-path',
        path: root,
      });
      assert.equal(createResult.isError, true);
      assert.equal(typeof createResult.content?.[0]?.text, 'string');
      assert.ok(createResult.structuredContent?.error);
      assert.equal(createResult.structuredContent.error.category, 'conflict');
      assert.equal(typeof createResult.structuredContent.error.errorCode, 'string');
      assert.equal(typeof createResult.structuredContent.error.retryable, 'boolean');
      assert.equal(typeof createResult.structuredContent.error.suggestedAction, 'string');

      assert.match(tools.get('task_status')!.description, /Compatibility alias/);
      assert.match(tools.get('task_list')!.description, /Compatibility alias/);
      assert.match(tools.get('task_kill')!.description, /Compatibility alias/);
      assert.ok(tools.has('process_manager'));
    } finally {
      logger.close();
    }
  });
});
