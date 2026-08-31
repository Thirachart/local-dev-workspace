import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SnapshotManager } from '../src/core/snapshotManager.js';
import { ProcessService } from '../src/services/processService.js';

describe('Task 2: SnapshotManager & 8 Conformance Checks', () => {
  const testDir = path.resolve(process.cwd(), `tmp-snap-suite-${Date.now()}`);
  let proc: ProcessService;
  let manager: SnapshotManager;

  before(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testDir, { recursive: true });
    proc = new ProcessService(testDir);
    await proc.runCommand({ command: 'git init', cwd: testDir });
    await proc.runCommand({ command: 'git config user.name "Tester"', cwd: testDir });
    await proc.runCommand({ command: 'git config user.email "test@example.com"', cwd: testDir });
    await proc.runCommand({ command: 'git config core.autocrlf false', cwd: testDir });

    // .gitignore
    await fs.writeFile(path.join(testDir, '.gitignore'), 'ignored.log\nnode_modules/\n.chat-dev/\n');
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'version 1 content\n');
    await proc.runCommand({ command: 'git add -A', cwd: testDir });
    await proc.runCommand({ command: 'git commit -m "initial commit"', cwd: testDir });
    await proc.runCommand({ command: 'git branch -M main', cwd: testDir });

    manager = new SnapshotManager(proc, testDir);
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('Check 1: baseline observation token is clean', async () => {
    const snap = await manager.getObservationToken();
    assert.ok(snap.snapshotId.startsWith('snap_'));
    assert.strictEqual(snap.git.dirty, false);
    assert.strictEqual(snap.git.modifiedCount, 0);
    assert.strictEqual(snap.git.untrackedCount, 0);
  });

  it('Check 2: tracked modified file changes snapshotId', async () => {
    const snapBefore = await manager.getObservationToken();
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'version 2 modified content\n');
    const snapAfter = await manager.getObservationToken();
    assert.notStrictEqual(snapBefore.snapshotId, snapAfter.snapshotId);
    assert.strictEqual(snapAfter.git.dirty, true);
    assert.strictEqual(snapAfter.git.modifiedCount, 1);

    // Revert modification
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'version 1 content\n');
  });

  it('Check 3: untracked file changes snapshotId', async () => {
    const snapBefore = await manager.getObservationToken();
    await fs.writeFile(path.join(testDir, 'untracked.txt'), 'new untracked file\n');
    const snapAfter = await manager.getObservationToken();
    assert.notStrictEqual(snapBefore.snapshotId, snapAfter.snapshotId);
    assert.strictEqual(snapAfter.git.dirty, true);
    assert.strictEqual(snapAfter.git.untrackedCount, 1);

    // Remove untracked file
    await fs.unlink(path.join(testDir, 'untracked.txt'));
  });

  it('Check 4: ignored file (.gitignore) does NOT change snapshotId', async () => {
    const snapBefore = await manager.getObservationToken();
    await fs.writeFile(path.join(testDir, 'ignored.log'), 'some log data that is ignored\n');
    const snapAfter = await manager.getObservationToken();
    assert.strictEqual(snapBefore.snapshotId, snapAfter.snapshotId, 'Ignored files MUST NOT alter snapshotId');
    assert.strictEqual(snapAfter.git.dirty, false);

    await fs.unlink(path.join(testDir, 'ignored.log'));
  });

  it('Check 5: staged-only change changes snapshotId', async () => {
    const snapBefore = await manager.getObservationToken();
    await fs.writeFile(path.join(testDir, 'staged.txt'), 'staged content\n');
    await proc.runCommand({ command: 'git add staged.txt', cwd: testDir });
    const snapAfter = await manager.getObservationToken();
    assert.notStrictEqual(snapBefore.snapshotId, snapAfter.snapshotId);
    assert.strictEqual(snapAfter.git.stagedCount, 1);

    // Reset staged file
    await proc.runCommand({ command: 'git reset HEAD staged.txt', cwd: testDir });
    await fs.unlink(path.join(testDir, 'staged.txt'));
  });

  it('Check 6: instructions file change changes snapshotId', async () => {
    const snapBefore = await manager.getObservationToken();
    await fs.writeFile(path.join(testDir, 'CLAUDE.md'), '# Project Instructions\n');
    const snapAfter = await manager.getObservationToken();
    assert.notStrictEqual(snapBefore.snapshotId, snapAfter.snapshotId);
    assert.notStrictEqual(snapBefore.instructionsCombinedHash, snapAfter.instructionsCombinedHash);

    await fs.unlink(path.join(testDir, 'CLAUDE.md'));
  });

  it('Check 7 (DoD 18): checkout another branch with the exact same HEAD commit changes snapshotId', async () => {
    const snapMain = await manager.getObservationToken();
    assert.strictEqual(snapMain.git.branch, 'main');

    // Create and checkout release branch pointing at exact same HEAD
    await proc.runCommand({ command: 'git checkout -b release', cwd: testDir });
    const snapRelease = await manager.getObservationToken();

    assert.strictEqual(snapRelease.git.branch, 'release');
    assert.strictEqual(snapRelease.git.head, snapMain.git.head);
    assert.notStrictEqual(
      snapMain.snapshotId,
      snapRelease.snapshotId,
      'Switching branch MUST alter snapshotId even if HEAD commit is identical'
    );

    // Switch back to main
    await proc.runCommand({ command: 'git checkout main', cwd: testDir });
  });

  it('Check 8 (DoD 19): staged content different from working copy captures index object state', async () => {
    const snapClean = await manager.getObservationToken();

    // Stage version A
    await fs.writeFile(path.join(testDir, 'split.txt'), 'version A in index\n');
    await proc.runCommand({ command: 'git add split.txt', cwd: testDir });

    // Modify working tree to version B
    await fs.writeFile(path.join(testDir, 'split.txt'), 'version B in working tree\n');

    const snapSplit = await manager.getObservationToken();
    assert.strictEqual(snapSplit.git.stagedCount, 1);
    assert.strictEqual(snapSplit.git.modifiedCount, 1);
    assert.notStrictEqual(snapSplit.git.indexTree, snapClean.git.indexTree);
    assert.notStrictEqual(snapSplit.snapshotId, snapClean.snapshotId);

    // Cleanup
    await proc.runCommand({ command: 'git reset HEAD split.txt', cwd: testDir });
    await fs.unlink(path.join(testDir, 'split.txt'));
  });
});
