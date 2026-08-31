import assert from 'node:assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { DiagnosticService } from '../src/services/diagnosticService.js';
import { GitService } from '../src/services/gitService.js';
import { GitWorkflowService } from '../src/services/gitWorkflowService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { SnapshotService } from '../src/services/snapshotService.js';
import { WorkspaceHealthService } from '../src/services/workspaceHealthService.js';
import { getGitSyncStatus } from '../src/git-intel/syncStatus.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

describe('Git upstream/ahead detection regression', () => {
  const root = path.join(os.tmpdir(), `chat-dev-git-tracking-${Date.now()}`);
  const repoDir = path.join(root, 'repo');
  const remoteDir = path.join(root, 'remote.git');
  let projectService: ProjectService;
  let processService: ProcessService;
  let gitService: GitService;
  let workflow: GitWorkflowService;
  let projectName: string;

  before(async () => {
    await fs.mkdir(repoDir, { recursive: true });
    await git(root, ['init', '--bare', remoteDir]);
    await git(repoDir, ['init', '-b', 'main']);
    await git(repoDir, ['config', 'user.name', 'Git Tracking Test']);
    await git(repoDir, ['config', 'user.email', 'git-tracking@example.com']);
    await git(repoDir, ['config', 'core.autocrlf', 'false']);

    await fs.writeFile(path.join(repoDir, 'README.md'), '# tracking fixture\n');
    await git(repoDir, ['add', 'README.md']);
    await git(repoDir, ['commit', '-m', 'initial']);
    await git(repoDir, ['remote', 'add', 'origin', remoteDir]);
    await git(repoDir, ['push', '-u', 'origin', 'main']);

    await git(repoDir, ['commit', '--allow-empty', '-m', 'local 1']);
    await git(repoDir, ['commit', '--allow-empty', '-m', 'local 2']);
    await git(repoDir, ['commit', '--allow-empty', '-m', 'local 3']);

    projectService = new ProjectService(repoDir);
    projectName = path.basename(repoDir);
    processService = new ProcessService(repoDir, projectService);
    gitService = new GitService(repoDir, projectService);
    workflow = new GitWorkflowService(processService, repoDir, projectService);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('detects origin/main with ahead 3 consistently across Git services', async () => {
    const status = await gitService.getStatus({ project: projectName });
    const sync = await workflow.getSyncStatus(undefined, projectName);
    const branch = await workflow.getBranchDetails(undefined, projectName);
    const intel = await getGitSyncStatus(new ProcessService(repoDir), repoDir);

    assert.strictEqual(status.upstream, 'origin/main');
    assert.strictEqual(status.ahead, 3);
    assert.strictEqual(status.behind, 0);
    assert.strictEqual(status.divergence, 'ahead');

    assert.strictEqual(sync.upstream, 'origin/main');
    assert.strictEqual(sync.ahead, 3);
    assert.strictEqual(sync.behind, 0);
    assert.strictEqual(sync.divergence, 'ahead');
    assert.strictEqual(sync.unpushedCommits.length, 3);

    assert.strictEqual(branch.upstreamBranch, 'origin/main');
    assert.strictEqual(branch.ahead, 3);
    assert.strictEqual(branch.behind, 0);

    assert.strictEqual(intel.upstream?.ref, 'origin/main');
    assert.strictEqual(intel.upstream?.ahead, 3);
    assert.strictEqual(intel.upstream?.behind, 0);
  });

  it('propagates tracking counts into snapshot and workspace health', async () => {
    const memory = new MemoryService(repoDir);
    const snapshotService = new SnapshotService(projectService, gitService, memory);
    const healthService = new WorkspaceHealthService(
      projectService,
      gitService,
      new DiagnosticService(processService, repoDir, projectService),
      processService,
      memory,
      repoDir
    );

    const snapshot = await snapshotService.getSnapshot({ project: projectName, compact: true });
    const health = await healthService.getHealth({ project: projectName });

    assert.strictEqual(snapshot.git.ahead, 3);
    assert.strictEqual(snapshot.git.behind, 0);
    assert.strictEqual(health.git.ahead, 3);
    assert.strictEqual(health.git.behind, 0);
  });

  it('does not add upstream setup to dry-run push when tracking already exists', async () => {
    const push = await workflow.pushBranch({
      project: projectName,
      dryRun: true,
    });

    assert.doesNotMatch(`${push.stdout}\n${push.stderr}`, /Would set upstream/i);
  });
});
