import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessService } from '../src/services/processService.js';
import { SnapshotManager } from '../src/core/snapshotManager.js';
import { getGitSyncStatus } from '../src/git-intel/syncStatus.js';
import { listGitWorktrees } from '../src/git-intel/worktrees.js';
import { compareGitBranches } from '../src/git-intel/branchCompare.js';
import { closeFeatureBranch } from '../src/git-intel/branchLifecycle.js';
import { safeGitCommit } from '../src/git-intel/commitService.js';

describe('Task 5: Git Intelligence Module', () => {
  const testDir = path.resolve(process.cwd(), `tmp-git-intel-${Date.now()}`);
  let proc: ProcessService;
  let snapshotManager: SnapshotManager;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    proc = new ProcessService(testDir);
    snapshotManager = new SnapshotManager(proc, testDir);
    await proc.runCommand({ command: 'git init', cwd: testDir });
    await proc.runCommand({ command: 'git config user.name "Tester"', cwd: testDir });
    await proc.runCommand({ command: 'git config user.email "test@example.com"', cwd: testDir });
    await proc.runCommand({ command: 'git config core.autocrlf false', cwd: testDir });

    await fs.writeFile(path.join(testDir, 'main.txt'), 'main file\n');
    await proc.runCommand({ command: 'git add -A', cwd: testDir });
    await proc.runCommand({ command: 'git commit -m "initial commit on main"', cwd: testDir });
    await proc.runCommand({ command: 'git branch -M main', cwd: testDir });

    // Create feature branch
    await proc.runCommand({ command: 'git checkout -b feat-login', cwd: testDir });
    await fs.writeFile(path.join(testDir, 'login.txt'), 'login feature\n');
    await proc.runCommand({ command: 'git add -A', cwd: testDir });
    await proc.runCommand({ command: 'git commit -m "feat: add login"', cwd: testDir });
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('Check 1: getGitSyncStatus detects local branch and cleanliness', async () => {
    const sync = await getGitSyncStatus(proc, testDir);
    assert.strictEqual(sync.local.branch, 'feat-login');
    assert.strictEqual(sync.dirty, false);
    assert.strictEqual(sync.main?.aheadOfMain, 1);
  });

  it('Check 2: compareGitBranches detects 1 commit ahead on feat-login', async () => {
    const cmp = await compareGitBranches(proc, testDir, 'main', 'feat-login');
    assert.strictEqual(cmp.ahead, 1);
    assert.strictEqual(cmp.behind, 0);
    assert.strictEqual(cmp.changedFiles.length, 1);
    assert.strictEqual(cmp.changedFiles[0].path, 'login.txt');
  });

  it('Check 3: listGitWorktrees parses worktree list cleanly', async () => {
    const wt = await listGitWorktrees(proc, testDir);
    assert.ok(wt.worktrees.length >= 1);
    assert.strictEqual(wt.worktrees[0].branch, 'feat-login');
  });

  it('Check 4: safeGitCommit performs guarded commit with snapshot tracking', async () => {
    await fs.writeFile(path.join(testDir, 'newfile.txt'), 'content v1\n');
    const obs = await snapshotManager.getObservationToken(testDir);

    const commitRes = await safeGitCommit(
      proc,
      testDir,
      {
        message: 'feat: add newfile',
        expectedSnapshotId: obs.snapshotId,
      },
      snapshotManager
    );

    assert.strictEqual(commitRes.success, true);
    assert.ok(commitRes.commitHash.length >= 40);
    assert.strictEqual(commitRes.branch, 'feat-login');
    assert.ok(commitRes.snapshotAfter !== commitRes.snapshotBefore);
  });

  it('Check 5: safeGitCommit rejects commit when snapshot is stale', async () => {
    await fs.writeFile(path.join(testDir, 'stalefile.txt'), 'stale content\n');
    await assert.rejects(
      () =>
        safeGitCommit(
          proc,
          testDir,
          {
            message: 'feat: stale commit',
            expectedSnapshotId: 'snap_stale12345678',
          },
          snapshotManager
        ),
      (err: any) => err.code === 'STALE_SNAPSHOT' && err.category === 'conflict'
    );
    await fs.unlink(path.join(testDir, 'stalefile.txt')).catch(() => {});
  });

  it('Check 6: closeFeatureBranch merges and cleans up branch with verification pass', async () => {
    const closeRes = await closeFeatureBranch(proc, testDir, {
      branch: 'feat-login',
      target: 'main',
      strategy: 'merge',
      deleteLocal: true,
    });

    assert.strictEqual(closeRes.success, true);
    assert.strictEqual(closeRes.mergedBranch, 'feat-login');
    assert.strictEqual(closeRes.deletedLocalBranch, true);

    const syncAfter = await getGitSyncStatus(proc, testDir);
    assert.strictEqual(syncAfter.local.branch, 'main');
  });
});
