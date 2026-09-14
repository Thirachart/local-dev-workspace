import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import { parse as parseYaml } from 'yaml';

import { MutationJournal } from '../src/mutation/mutationJournal.js';
import { FileService } from '../src/services/fileService.js';
import { GitService } from '../src/services/gitService.js';
import { PatchService } from '../src/services/patchService.js';
import { ProductivityService } from '../src/services/productivityService.js';
import { ProjectService } from '../src/services/projectService.js';

const execFileAsync = promisify(execFile);
const tempPaths: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempPaths.length) {
    await fs.rm(tempPaths.pop()!, { recursive: true, force: true });
  }
});

async function makeProductivityFixture() {
  const root = await makeTemp('chat-dev-p2-root-');
  const state = await makeTemp('chat-dev-p2-state-');
  const projectService = new ProjectService(root);
  const fileService = new FileService(root, projectService);
  const patchService = new PatchService(root, projectService);
  const journal = new MutationJournal(state);
  const productivity = new ProductivityService(fileService, patchService, projectService, journal);
  return { root, state, project: path.basename(root), projectService, fileService, patchService, journal, productivity };
}

describe('P2 mutation journal and CAS-safe undo', () => {
  it('undoes a journaled replacement and removes a journaled newly-created file', async () => {
    const { root, project, fileService, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'note.txt'), 'before\n', 'utf8');
    const hash = (await fileService.hashFile('note.txt', { project })).sha256;

    const replacement = await productivity.journalMutation('write', ['note.txt'], { project }, () =>
      fileService.writeFile('note.txt', 'after\n', { project, mode: 'replace_if_hash', expectedBeforeHash: hash }),
    );
    assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), 'after\n');
    assert.equal(replacement.mutation.undoable, true);

    await productivity.undoOperation(project, replacement.mutation.operationId);
    assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), 'before\n');

    const created = await productivity.journalMutation('write', ['created.txt'], { project }, () =>
      fileService.writeFile('created.txt', 'new file\n', { project, mode: 'create_only' }),
    );
    assert.equal(await fs.readFile(path.join(root, 'created.txt'), 'utf8'), 'new file\n');
    await productivity.undoOperation(project, created.mutation.operationId);
    await assert.rejects(fs.stat(path.join(root, 'created.txt')));
  });

  it('refuses undo when the current target no longer matches the recorded after-state', async () => {
    const { root, project, fileService, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'note.txt'), 'one\n', 'utf8');
    const hash = (await fileService.hashFile('note.txt', { project })).sha256;
    const mutation = await productivity.journalMutation('write', ['note.txt'], { project }, () =>
      fileService.writeFile('note.txt', 'two\n', { project, mode: 'replace_if_hash', expectedBeforeHash: hash }),
    );

    await fs.writeFile(path.join(root, 'note.txt'), 'third-party change\n', 'utf8');
    await assert.rejects(
      productivity.undoOperation(project, mutation.mutation.operationId),
      (error: any) => error?.code === 'UNDO_CONCURRENCY_CONFLICT',
    );
    assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), 'third-party change\n');
  });

  it('rolls back a partially-applied multi-file patch when a later file conflicts', async () => {
    const { root, project, patchService, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'first.txt'), 'alpha\n', 'utf8');
    await fs.writeFile(path.join(root, 'second.txt'), 'beta\n', 'utf8');

    await assert.rejects(
      productivity.journalMutation('patch', ['first.txt', 'second.txt'], { project }, () =>
        patchService.applyStructuredPatch([
          { filePath: 'first.txt', targetContent: 'alpha', replacementContent: 'ALPHA' },
          { filePath: 'second.txt', targetContent: 'missing', replacementContent: 'BETA' },
        ], { project }),
      ),
    );

    assert.equal(await fs.readFile(path.join(root, 'first.txt'), 'utf8'), 'alpha\n');
    assert.equal(await fs.readFile(path.join(root, 'second.txt'), 'utf8'), 'beta\n');
  });
});

describe('P2 file-only changesets', () => {
  it('records one multi-file changeset and can undo all touched files', async () => {
    const { root, project, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'a.txt'), 'A0\n', 'utf8');
    await fs.writeFile(path.join(root, 'b.txt'), 'B0\n', 'utf8');

    const result = await productivity.applyChangeset({
      project,
      operations: [
        { type: 'edit', path: 'a.txt', targetContent: 'A0', replacementContent: 'A1' },
        { type: 'edit', path: 'b.txt', targetContent: 'B0', replacementContent: 'B1' },
      ],
    });
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'A1\n');
    assert.equal(await fs.readFile(path.join(root, 'b.txt'), 'utf8'), 'B1\n');

    await productivity.undoOperation(project, result.operationId);
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'A0\n');
    assert.equal(await fs.readFile(path.join(root, 'b.txt'), 'utf8'), 'B0\n');
  });

  it('rolls back earlier file edits when a later changeset operation fails', async () => {
    const { root, project, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'a.txt'), 'A0\n', 'utf8');
    await fs.writeFile(path.join(root, 'b.txt'), 'B0\n', 'utf8');

    await assert.rejects(productivity.applyChangeset({
      project,
      operations: [
        { type: 'edit', path: 'a.txt', targetContent: 'A0', replacementContent: 'A1' },
        { type: 'edit', path: 'b.txt', targetContent: 'DOES_NOT_EXIST', replacementContent: 'B1' },
      ],
    }));
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'A0\n');
    assert.equal(await fs.readFile(path.join(root, 'b.txt'), 'utf8'), 'B0\n');
  });
});

describe('P2 copy/sync and structured config mutation', () => {
  it('copies across explicit projects, verifies content, and can undo the target', async () => {
    const root = await makeTemp('chat-dev-p2-copy-root-');
    const state = await makeTemp('chat-dev-p2-copy-state-');
    const sourceDir = path.join(root, 'source');
    const targetDir = path.join(root, 'target');
    await fs.mkdir(sourceDir);
    await fs.mkdir(targetDir);
    await fs.writeFile(path.join(sourceDir, 'payload.bin'), Buffer.from([0, 1, 2, 3, 250, 251]));
    await fs.writeFile(path.join(targetDir, 'payload.bin'), Buffer.from('old'));

    const projectService = new ProjectService(root);
    await projectService.addProject({ name: 'source', path: sourceDir });
    await projectService.addProject({ name: 'target', path: targetDir });
    const fileService = new FileService(root, projectService);
    const patchService = new PatchService(root, projectService);
    const productivity = new ProductivityService(fileService, patchService, projectService, new MutationJournal(state));
    const sourceHash = (await fileService.hashFile('payload.bin', { project: 'source' })).sha256;

    const copied = await productivity.copyFile({
      sourceProject: 'source',
      sourcePath: 'payload.bin',
      targetProject: 'target',
      targetPath: 'payload.bin',
      expectedSourceHash: sourceHash,
    });
    assert.equal(copied.changed, true);
    assert.equal(copied.sourceHash, copied.targetHash);
    assert.ok(copied.operationId);

    const synced = await productivity.copyFile({
      sourceProject: 'source',
      sourcePath: 'payload.bin',
      targetProject: 'target',
      targetPath: 'payload.bin',
      syncOnly: true,
    });
    assert.equal(synced.changed, false);

    await productivity.undoOperation('target', copied.operationId!);
    assert.equal((await fs.readFile(path.join(targetDir, 'payload.bin'))).toString(), 'old');
  });

  it('batches read/hash/compare operations without mutating files', async () => {
    const { root, project, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'a.txt'), 'same\n', 'utf8');
    await fs.writeFile(path.join(root, 'b.txt'), 'same\n', 'utf8');

    const batch = await productivity.batchRead({
      project,
      operations: [
        { type: 'hash', path: 'a.txt' },
        { type: 'read', path: 'a.txt', startLine: 1, endLine: 1 },
        { type: 'compare', pathA: 'a.txt', pathB: 'b.txt' },
      ],
    });
    assert.equal(batch.count, 3);
    assert.equal((batch.results[2] as any).identical, true);
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'same\n');
  });

  it('patches JSON and YAML structurally and supports undo', async () => {
    const { root, project, productivity } = await makeProductivityFixture();
    await fs.writeFile(path.join(root, 'config.json'), '{"server":{"port":3000},"drop":true}\n', 'utf8');
    await fs.writeFile(path.join(root, 'config.yaml'), 'server:\n  port: 3000\ndrop: true\n', 'utf8');

    const jsonPatch = await productivity.patchConfig({
      format: 'json', project, path: 'config.json', operations: [
        { op: 'set', path: '/server/port', value: 4100 },
        { op: 'remove', path: '/drop' },
      ],
    });
    const json = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
    assert.deepEqual(json, { server: { port: 4100 } });
    await productivity.undoOperation(project, jsonPatch.operationId);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8')), { server: { port: 3000 }, drop: true });

    const yamlPatch = await productivity.patchConfig({
      format: 'yaml', project, path: 'config.yaml', operations: [
        { op: 'set', path: '/server/port', value: 4200 },
        { op: 'remove', path: '/drop' },
      ],
    });
    assert.deepEqual(parseYaml(await fs.readFile(path.join(root, 'config.yaml'), 'utf8')), { server: { port: 4200 } });
    await productivity.undoOperation(project, yamlPatch.operationId);
    assert.deepEqual(parseYaml(await fs.readFile(path.join(root, 'config.yaml'), 'utf8')), { server: { port: 3000 }, drop: true });
  });
});

describe('P2 Git productivity helpers', () => {
  it('stages, unstages, and reads a file at a revision', async () => {
    const root = await makeTemp('chat-dev-p2-git-');
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
    await fs.writeFile(path.join(root, 'file.txt'), 'v1\n', 'utf8');
    await execFileAsync('git', ['add', 'file.txt'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
    await fs.writeFile(path.join(root, 'file.txt'), 'v2\n', 'utf8');

    const git = new GitService(root);
    await git.stage(['file.txt']);
    const staged = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: root });
    assert.equal(staged.stdout.trim(), 'file.txt');

    await git.unstage(['file.txt']);
    const unstaged = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: root });
    assert.equal(unstaged.stdout.trim(), '');

    const shown = await git.showFile('HEAD', 'file.txt');
    assert.equal(shown.content, 'v1\n');
    await assert.rejects(git.showFile('HEAD', '../outside.txt'));
  });
});
