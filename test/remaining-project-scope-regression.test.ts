import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DiagnosticService } from '../src/services/diagnosticService.js';
import { GitService } from '../src/services/gitService.js';
import { GitWorkflowService } from '../src/services/gitWorkflowService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { SnapshotService } from '../src/services/snapshotService.js';
import { SymbolService } from '../src/services/symbolService.js';
import { TestRunnerService } from '../src/services/testRunnerService.js';
import { WorkspaceHealthService } from '../src/services/workspaceHealthService.js';
import * as sseTransport from '../src/transports/sse.js';

describe('Remaining project-scoping regressions', () => {
  const testDir = path.join(os.tmpdir(), `chat-dev-project-regression-${Date.now()}`);
  let projectService: ProjectService;
  let processService: ProcessService;
  let projectName: string;

  before(async () => {
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'one.ts'), 'export const one = 1;\n');
    await fs.writeFile(path.join(testDir, 'src', 'two.ts'), 'export const two = 2;\n');
    projectService = new ProjectService(testDir);
    projectName = path.basename(testDir);
    processService = new ProcessService(testDir, projectService);
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('marks compact snapshot rootPath as the selected project root', async () => {
    const gitService = new GitService(testDir, projectService);
    const snapshotService = new SnapshotService(
      projectService,
      gitService,
      new MemoryService(testDir)
    );

    const snapshot = await snapshotService.getSnapshot({ project: projectName, compact: true });

    assert.strictEqual(snapshot.project.rootPath, '.');
    assert.strictEqual(snapshot.project.pathScope, 'project-root');
  });

  it('reports unavailable Git state instead of false main and clean defaults', async () => {
    const gitService = new GitService(testDir, projectService);
    const healthService = new WorkspaceHealthService(
      projectService,
      gitService,
      new DiagnosticService(processService, testDir, projectService),
      processService,
      new MemoryService(testDir),
      testDir
    );

    const health = await healthService.getHealth({ project: projectName });

    assert.strictEqual(health.git.isGitRepo, false);
    assert.strictEqual(health.git.branch, 'unknown');
    assert.strictEqual(health.git.isClean, false);
    assert.match(health.git.error || '', /not a git repository/i);
    assert.strictEqual(health.overallStatus, 'needs_attention');
  });

  it('recognizes an unborn Git repository before its first commit', async () => {
    await processService.runCommand({ command: 'git init -b main', projectName });
    const gitService = new GitService(testDir, projectService);
    const workflow = new GitWorkflowService(processService, testDir, projectService);
    const snapshotService = new SnapshotService(
      projectService,
      gitService,
      new MemoryService(testDir)
    );

    const status = await gitService.getStatus({ project: projectName });
    const log = await gitService.getLog({ project: projectName });
    const sync = await workflow.getSyncStatus(undefined, projectName);
    const branch = await workflow.getBranchDetails(undefined, projectName);
    const snapshot = await snapshotService.getSnapshot({ project: projectName, compact: true });

    assert.strictEqual(status.isGitRepo, true);
    assert.strictEqual(status.branch, 'main');
    assert.strictEqual(log.isGitRepo, true);
    assert.deepStrictEqual(log.commits, []);
    assert.match(sync.fingerprint, /^unborn:/);
    assert.strictEqual(branch.currentBranch, 'main');
    assert.deepStrictEqual(branch.branches, [{
      name: 'main',
      isCurrent: true,
      isRemote: false,
      commitHash: 'unborn',
      commitMessage: 'No commits yet',
    }]);
    assert.strictEqual(snapshot.project.isGitRepo, true);
  });

  it('does not invent npm test for a generic project without test configuration', async () => {
    const runner = new TestRunnerService(processService, testDir, projectService);

    const result = await runner.runTests({ project: projectName });

    assert.strictEqual(result.status, 'not_configured');
    assert.strictEqual(result.framework, 'generic');
    assert.strictEqual(result.command, null);
    assert.strictEqual(result.total, 0);
    assert.match(result.summary, /no test framework or test command/i);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, '');
  });

  it('reports diagnostics as not configured instead of passing an echo command', async () => {
    const diagnostics = new DiagnosticService(processService, testDir, projectService);

    const result = await diagnostics.runDiagnostics('typecheck', { project: projectName });

    assert.ok('status' in result);
    assert.strictEqual(result.status, 'not_configured');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.commandRun, null);
    assert.strictEqual(result.exitCode, null);
    assert.match(result.summary, /not configured/i);
    assert.doesNotMatch(result.rawOutput, /No specific diagnostic command determined/i);
  });

  it('uses one Git changed count consistently in status, health, and snapshot', async () => {
    await processService.runCommand({ command: 'git config user.email "test@example.com"', projectName });
    await processService.runCommand({ command: 'git config user.name "Regression Test"', projectName });
    await processService.runCommand({ command: 'git add .', projectName });
    const commit = await processService.runCommand({ command: 'git commit -m baseline', projectName });
    assert.strictEqual(commit.exitCode, 0, commit.stderr || commit.stdout);
    await fs.writeFile(path.join(testDir, 'only-change.txt'), 'untracked\n');

    const gitService = new GitService(testDir, projectService);
    const diagnostics = new DiagnosticService(processService, testDir, projectService);
    const memory = new MemoryService(testDir);
    const healthService = new WorkspaceHealthService(
      projectService,
      gitService,
      diagnostics,
      processService,
      memory,
      testDir
    );
    const snapshotService = new SnapshotService(projectService, gitService, memory);

    const status = await gitService.getStatus({ project: projectName });
    const health = await healthService.getHealth({ project: projectName });
    const snapshot = await snapshotService.getSnapshot({ project: projectName, compact: true });

    assert.strictEqual(status.modifiedCount, 0);
    assert.strictEqual(status.untrackedCount, 1);
    assert.strictEqual(status.changedCount, 1);
    assert.strictEqual(health.git.changedCount, 1);
    assert.strictEqual(snapshot.git.modifiedCount, 0);
    assert.strictEqual(snapshot.git.untrackedCount, 1);
    assert.strictEqual(snapshot.git.stagedCount, 0);
    assert.strictEqual(snapshot.git.deletedCount, 0);
    assert.strictEqual(snapshot.git.changedCount, 1);
    assert.match(health.summary, /1 uncommitted change(?!s)/);
    assert.strictEqual(health.diagnostics.status, 'unknown');
    assert.match(health.summary, /Diagnostics: unavailable/);
  });

  it('does not retain completed synchronous commands as background tasks', async () => {
    await processService.runCommand({
      command: 'node -e "console.log(123)"',
      projectName,
    });

    assert.deepStrictEqual(processService.listTasks(projectName), []);
  });

  it('bounds reference discovery and reports truncated coverage', async () => {
    const symbolService = new SymbolService(testDir, projectService);

    const result = await symbolService.findReferences('missingSymbol', {
      project: projectName,
      maxFiles: 1,
      timeoutMs: 5_000,
    });

    assert.strictEqual(result.filesScanned, 1);
    assert.strictEqual(result.scanLimit, 1);
    assert.strictEqual(result.truncated, true);
  });

  it('reports an unparseable diagnostic command failure as failed rather than healthy', async () => {
    const gitService = new GitService(testDir, projectService);
    const failedDiagnostics = {
      runDiagnostics: async () => ({
        status: 'failed' as const,
        success: false,
        errorCount: 0,
        warningCount: 0,
        structuredErrors: [],
      }),
    } as unknown as DiagnosticService;
    const healthService = new WorkspaceHealthService(
      projectService,
      gitService,
      failedDiagnostics,
      processService,
      new MemoryService(testDir),
      testDir
    );

    const health = await healthService.getHealth({ project: projectName });

    assert.strictEqual(health.diagnostics.status, 'failed');
    assert.strictEqual(health.diagnostics.errorCount, 0);
    assert.strictEqual(health.overallStatus, 'error');
    assert.match(health.summary, /command failed.*no parsable/i);
  });

  it('preserves an explicit diagnostics command at the REST request seam', () => {
    const requestMapper = (sseTransport as Record<string, unknown>).getProjectDiagnosticsRequest;
    assert.strictEqual(typeof requestMapper, 'function');
    const request = (requestMapper as Function)({
      project: projectName,
      task: 'test',
      cwd: 'nested',
      command: 'python -m unittest discover',
    });

    assert.deepStrictEqual(request, {
      task: 'test',
      options: {
        customCwd: 'nested',
        project: projectName,
        command: 'python -m unittest discover',
      },
    });
  });

  it('preserves an explicit diagnostics command for a Python project', async () => {
    const pythonDir = path.join(testDir, 'python-diagnostics');
    await fs.mkdir(pythonDir, { recursive: true });
    await fs.writeFile(path.join(pythonDir, 'pyproject.toml'), '[project]\nname = "fixture"\nversion = "0.0.1"\n');
    const diagnostics = new DiagnosticService(processService, testDir, projectService);

    const result = await diagnostics.runDiagnostics('test', {
      project: projectName,
      customCwd: 'python-diagnostics',
      command: 'node -e "process.exit(0)"',
    });

    assert.ok('commandRun' in result);
    assert.strictEqual(result.commandRun, 'node -e "process.exit(0)"');
    assert.strictEqual(result.success, true);
  });


  it('preserves complete Python signatures with annotations and multiline async definitions', async () => {
    const source = [
      'def add(left: int, right: int) -> int:',
      '    return left + right',
      '',
      'class Calculator:',
      '    async def divide(',
      '        self,',
      '        left: int,',
      '        right: int,',
      '    ) -> float:',
      '        return left / right',
      '',
    ].join('\n');
    await fs.writeFile(path.join(testDir, 'calculator.py'), source);

    const symbolService = new SymbolService(testDir, projectService);
    const listed = await symbolService.listSymbols('calculator.py', { project: projectName });
    const add = listed.symbols.find((symbol) => symbol.name === 'add');
    const divide = listed.symbols.find((symbol) => symbol.name === 'divide');

    assert.strictEqual(listed.parser, 'python-ast');
    assert.strictEqual(add?.signature, 'def add(left: int, right: int) -> int');
    assert.strictEqual(divide?.signature, 'async def divide( self, left: int, right: int, ) -> float');

    const read = await symbolService.readSymbol('calculator.py', 'Calculator.divide', { project: projectName });
    assert.strictEqual(read.symbol.signature, 'async def divide( self, left: int, right: int, ) -> float');
    assert.match(read.symbol.content, /async def divide\(/);
    assert.match(read.symbol.content, /return left \/ right/);
  });

});
