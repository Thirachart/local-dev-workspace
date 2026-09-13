import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FileService } from '../src/services/fileService.js';
import { GitService } from '../src/services/gitService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { SearchService } from '../src/services/searchService.js';
import { registerTools } from '../src/tools/index.js';
import { Logger } from '../src/utils/logger.js';

type RegisteredTool = {
  schema: Record<string, any>;
  handler: (args: any, extra?: { sessionId?: string }) => Promise<any>;
};

function parseToolText(result: any): any {
  assert.notEqual(result?.isError, true, result?.content?.[0]?.text || 'tool failed');
  return JSON.parse(result.content[0].text);
}

function toolErrorText(result: any): string {
  assert.equal(result?.isError, true, 'expected tool error');
  return String(result?.content?.[0]?.text || '');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('P0 safety: snapshot contract and safe public git commit', () => {
  let tempDir: string;
  let loggerDir: string;
  let stateDir: string;
  let projectName: string;
  let tools: Map<string, RegisteredTool>;
  let processService: ProcessService;
  let logger: Logger;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-tools-'));
    loggerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-logs-'));
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-state-'));
    projectName = path.basename(tempDir);
    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'alpha\n', 'utf8');

    const projectService = new ProjectService(tempDir);
    processService = new ProcessService(tempDir, projectService);
    await processService.runCommand({ command: 'git init -b main', projectName });
    await processService.runCommand({ command: 'git config user.email "p0@example.com"', projectName });
    await processService.runCommand({ command: 'git config user.name "P0 Safety Test"', projectName });
    await processService.runCommand({ command: 'git add sample.txt', projectName });
    await processService.runCommand({ command: 'git commit -m "initial"', projectName });

    const fileService = new FileService(tempDir, projectService);
    const searchService = new SearchService(tempDir, projectService);
    const gitService = new GitService(tempDir, projectService);
    const memoryService = new MemoryService(stateDir);
    logger = new Logger(loggerDir);
    tools = new Map();

    const server = {
      tool(
        name: string,
        _description: string,
        schema: Record<string, any>,
        handler: (args: any, extra?: { sessionId?: string }) => Promise<any>,
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
      logger,
    });
  });

  after(async () => {
    logger.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(loggerDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it('makes required snapshot schema fields truly required while observe remains optional', () => {
    const editSnapshot = tools.get('edit_file')!.schema.expected_snapshot_id;
    const readSnapshot = tools.get('read_file')!.schema.expected_snapshot_id;
    assert.equal(editSnapshot.safeParse(undefined).success, false);
    assert.equal(readSnapshot.safeParse(undefined).success, true);
  });

  it('rejects missing snapshot and accepts workspaceObservationId from get_project_snapshot', async () => {
    const edit = tools.get('edit_file')!.handler;
    const missing = await edit({
      project: projectName,
      path: 'sample.txt',
      target_content: 'alpha',
      replacement_content: 'beta',
    });
    assert.match(toolErrorText(missing), /SNAPSHOT_REQUIRED/);

    const snapshot = parseToolText(await tools.get('get_project_snapshot')!.handler({
      project: projectName,
      compact: true,
    }));
    assert.match(snapshot.workspaceObservationId, /^snap_[0-9a-f]+$/);

    const edited = await edit({
      project: projectName,
      path: 'sample.txt',
      target_content: 'alpha',
      replacement_content: 'beta',
      expected_snapshot_id: snapshot.workspaceObservationId,
    });
    assert.notEqual(edited?.isError, true, edited?.content?.[0]?.text);
    assert.equal(await fs.readFile(path.join(tempDir, 'sample.txt'), 'utf8'), 'beta\n');
  });

  it('safe git_commit commits with a current token and rejects stale, verification, and file-hash conflicts', async () => {
    const snapshotTool = tools.get('get_project_snapshot')!.handler;
    const commitTool = tools.get('git_commit')!.handler;

    const current = parseToolText(await snapshotTool({ project: projectName, compact: true }));
    const committed = parseToolText(await commitTool({
      project: projectName,
      message: 'safe public commit',
      files: ['sample.txt'],
      expected_snapshot_id: current.workspaceObservationId,
    }));
    assert.equal(committed.success, true);
    assert.deepEqual(committed.filesCommitted, ['sample.txt']);

    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'verification-change\n', 'utf8');
    const verificationSnapshot = parseToolText(await snapshotTool({ project: projectName, compact: true }));
    const verificationFailure = await commitTool({
      project: projectName,
      message: 'must not commit',
      files: ['sample.txt'],
      expected_snapshot_id: verificationSnapshot.workspaceObservationId,
      verification_command: 'node -e "process.exit(7)"',
    });
    assert.match(toolErrorText(verificationFailure), /COMMAND_FAILED|verification failed/i);
    const cachedAfterVerification = await processService.runCommand({ command: 'git diff --cached --name-only', projectName });
    assert.equal(cachedAfterVerification.stdout.trim(), '');

    const hashSnapshot = parseToolText(await snapshotTool({ project: projectName, compact: true }));
    const hashFailure = await commitTool({
      project: projectName,
      message: 'must not commit hash mismatch',
      files: ['sample.txt'],
      expected_snapshot_id: hashSnapshot.workspaceObservationId,
      expected_file_hashes: { 'sample.txt': 'deadbeef' },
    });
    assert.match(toolErrorText(hashFailure), /CONCURRENCY_CONFLICT/);
    const cachedAfterHash = await processService.runCommand({ command: 'git diff --cached --name-only', projectName });
    assert.equal(cachedAfterHash.stdout.trim(), '');

    const staleSnapshot = parseToolText(await snapshotTool({ project: projectName, compact: true }));
    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'stale-change-with-different-size\n', 'utf8');
    const staleFailure = await commitTool({
      project: projectName,
      message: 'must not commit stale snapshot',
      files: ['sample.txt'],
      expected_snapshot_id: staleSnapshot.workspaceObservationId,
    });
    assert.match(toolErrorText(staleFailure), /STALE_SNAPSHOT/);
  });
});

describe('P0 safety: atomic and CAS-safe write_file', () => {
  let tempDir: string;
  let projectName: string;
  let fileService: FileService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-write-'));
    projectName = path.basename(tempDir);
    const projectService = new ProjectService(tempDir);
    fileService = new FileService(tempDir, projectService);
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('defaults to create_only and refuses to overwrite an existing file', async () => {
    const created = await fileService.writeFile('safe.txt', 'one\n', { project: projectName });
    assert.equal(created.action, 'created');
    assert.match(created.afterHash, /^[0-9a-f]{64}$/);

    await assert.rejects(
      () => fileService.writeFile('safe.txt', 'two\n', { project: projectName }),
      (err: any) => err.code === 'FILE_EXISTS',
    );
    assert.equal(await fs.readFile(path.join(tempDir, 'safe.txt'), 'utf8'), 'one\n');
  });

  it('replace_if_hash succeeds only with the observed hash and leaves wrong-hash targets bit-identical', async () => {
    const file = path.join(tempDir, 'cas.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const before = await fs.readFile(file, 'utf8');
    const beforeHash = sha256(before);

    await assert.rejects(
      () => fileService.writeFile('cas.txt', 'corrupt\n', {
        project: projectName,
        mode: 'replace_if_hash',
        expectedBeforeHash: '0'.repeat(64),
      }),
      (err: any) => err.code === 'CONCURRENCY_CONFLICT',
    );
    assert.equal(await fs.readFile(file, 'utf8'), before);

    const replaced = await fileService.writeFile('cas.txt', 'after\n', {
      project: projectName,
      mode: 'replace_if_hash',
      expectedBeforeHash: beforeHash,
    });
    assert.equal(replaced.action, 'replaced');
    assert.equal(replaced.beforeHash, beforeHash);
    assert.equal(await fs.readFile(file, 'utf8'), 'after\n');
  });

  it('force mode is explicit and preserves CRLF on replacement', async () => {
    const file = path.join(tempDir, 'crlf.txt');
    await fs.writeFile(file, 'a\r\nb\r\n', 'utf8');
    const replaced = await fileService.writeFile('crlf.txt', 'c\nd\n', {
      project: projectName,
      mode: 'force',
    });
    assert.equal(replaced.action, 'replaced');
    assert.equal(await fs.readFile(file, 'utf8'), 'c\r\nd\r\n');
  });
});

describe('P0 safety: destructive project removal confirmation', () => {
  let registryRoot: string;
  let service: ProjectService;

  before(async () => {
    registryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-remove-registry-'));
    service = new ProjectService(registryRoot);
  });

  after(async () => {
    await fs.rm(registryRoot, { recursive: true, force: true });
  });

  async function addTarget(name: string): Promise<string> {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), `chat-dev-p0-${name}-`));
    await fs.writeFile(path.join(target, 'keep.txt'), `${name}\n`, 'utf8');
    await service.addProject({ name, path: target });
    return target;
  }

  it('keeps unregister-only behavior and refuses file deletion without a prepared token', async () => {
    const unregisterPath = await addTarget('unregister-only');
    await service.removeProject('unregister-only', false);
    assert.equal(await fs.readFile(path.join(unregisterPath, 'keep.txt'), 'utf8'), 'unregister-only\n');
    await fs.rm(unregisterPath, { recursive: true, force: true });

    const guardedPath = await addTarget('guarded-delete');
    await assert.rejects(
      () => service.removeProject('guarded-delete', true),
      (err: any) => err.code === 'DESTRUCTIVE_CONFIRMATION_REQUIRED',
    );
    assert.equal(await fs.readFile(path.join(guardedPath, 'keep.txt'), 'utf8'), 'guarded-delete\n');
  });

  it('binds confirmation token to project and rejects target changes after preparation', async () => {
    const guarded = service.getRequiredProject('guarded-delete');
    const otherPath = await addTarget('other-delete');
    const otherPlan = await service.prepareProjectRemoval('other-delete');
    assert.equal(otherPlan.targetPath, '.');
    assert.equal(otherPlan.pathScope, 'project-root');
    assert.equal('resolvedPath' in otherPlan, false, 'destructive preview must not expose local absolute paths');

    await assert.rejects(
      () => service.removeProject('guarded-delete', true, otherPlan.confirmationToken),
      (err: any) => err.code === 'INVALID_CONFIRMATION_TOKEN',
    );
    assert.ok(guarded);

    const guardedPlan = await service.prepareProjectRemoval('guarded-delete');
    await fs.appendFile(path.join(guarded.path, 'keep.txt'), 'changed-after-prepare\n', 'utf8');
    await assert.rejects(
      () => service.removeProject('guarded-delete', true, guardedPlan.confirmationToken),
      (err: any) => err.code === 'PROJECT_REMOVAL_TARGET_CHANGED',
    );

    const refreshed = await service.prepareProjectRemoval('guarded-delete');
    await service.removeProject('guarded-delete', true, refreshed.confirmationToken);
    await assert.rejects(() => fs.stat(guarded.path));

    await service.removeProject('other-delete', true, otherPlan.confirmationToken);
    await assert.rejects(() => fs.stat(otherPath));
  });

  it('rejects expired destructive confirmation tokens', async () => {
    const expiringPath = await addTarget('expiring-delete');
    (service as any).projectRemovalTtlMs = -1;
    const plan = await service.prepareProjectRemoval('expiring-delete');
    await assert.rejects(
      () => service.removeProject('expiring-delete', true, plan.confirmationToken),
      (err: any) => err.code === 'CONFIRMATION_TOKEN_EXPIRED',
    );
    assert.equal(await fs.readFile(path.join(expiringPath, 'keep.txt'), 'utf8'), 'expiring-delete\n');
    await service.removeProject('expiring-delete', false);
    await fs.rm(expiringPath, { recursive: true, force: true });
  });
});

describe('P0 safety: server handoff storage stays outside workspace', () => {
  let projectRoot: string;
  let stateRoot: string;

  before(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-handoff-project-'));
    stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-p0-handoff-state-'));
  });

  after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(stateRoot, { recursive: true, force: true });
  });

  it('writes persist=server outside repo and keeps legacy workspace handoff readable', async () => {
    const memory = new MemoryService(stateRoot);
    const serverWrite = await memory.writeHandoff(projectRoot, {
      content: 'server handoff',
      persist: 'server',
    });
    assert.equal(serverWrite.filePath, 'server://handoff.md');
    await assert.rejects(() => fs.stat(path.join(projectRoot, '.chat-dev', 'handoff.md')));
    await assert.rejects(() => fs.stat(path.join(projectRoot, 'HANDOFF.md')));

    const serverRead = await memory.readHandoff(projectRoot);
    assert.equal(serverRead.filePath, 'server://handoff.md');
    assert.equal(serverRead.content, 'server handoff\n');

    const legacyDir = path.join(projectRoot, '.chat-dev');
    const legacyFile = path.join(legacyDir, 'handoff.md');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(legacyFile, 'legacy handoff\n', 'utf8');
    const future = new Date(Date.now() + 5_000);
    await fs.utimes(legacyFile, future, future);

    const legacyRead = await memory.readHandoff(projectRoot);
    assert.equal(legacyRead.filePath, '.chat-dev/handoff.md');
    assert.equal(legacyRead.content, 'legacy handoff\n');
  });

  it('preserves explicit custom-path behavior', async () => {
    const memory = new MemoryService(stateRoot);
    const result = await memory.writeHandoff(projectRoot, {
      content: 'custom handoff',
      persist: 'server',
      path: 'notes/custom-handoff.md',
    });
    assert.equal(result.filePath, 'notes/custom-handoff.md');
    assert.equal(await fs.readFile(path.join(projectRoot, 'notes', 'custom-handoff.md'), 'utf8'), 'custom handoff\n');
  });
});
