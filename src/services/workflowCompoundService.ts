import { DiagnosticService, DiagnosticResult } from './diagnosticService.js';
import { GitService } from './gitService.js';
import { ProjectService } from './projectService.js';
import { ProcessService } from './processService.js';

export interface VerifyChangesOptions {
  project?: string;
  cwd?: string;
  tasks?: Array<'typecheck' | 'build' | 'test'>;
  testFilter?: string;
  sessionId?: string;
  skipTests?: boolean;
}

export interface VerifyChangesResult {
  status: 'PASS' | 'FAIL';
  summary: string;
  failedStep?: 'typecheck' | 'build' | 'test';
  typecheck?: string;
  build?: string;
  tests?: string;
  errors?: any[];
  git?: {
    branch?: string;
    changedFiles: number;
    modified: number;
    staged: number;
    untracked: number;
    files: string[];
  };
}

export interface CommitAndPushOptions {
  message: string;
  project?: string;
  cwd?: string;
  files?: string[];
  branch?: string;
  remote?: string;
  push?: boolean;
  sessionId?: string;
}

export interface CommitAndPushResult {
  status: 'success' | 'clean' | 'error';
  commitHash?: string;
  message?: string;
  branch?: string;
  pushed?: boolean;
  filesCommitted?: string[];
  summary?: string;
  error?: string;
}

export class WorkflowCompoundService {
  constructor(
    private readonly diagnosticService: DiagnosticService,
    private readonly gitService: GitService,
    private readonly projectService?: ProjectService,
    private readonly processService?: ProcessService
  ) {}

  /**
   * Run typecheck -> build -> tests -> git status in a single roundtrip.
   * Returns a concise PASS / FAIL report.
   */
  public async verifyChanges(options: VerifyChangesOptions = {}): Promise<VerifyChangesResult> {
    const project = options.project || this.projectService?.getActiveProject(options.sessionId)?.name;
    const tasksToRun = options.tasks || (options.skipTests ? ['typecheck', 'build'] : ['typecheck', 'build', 'test']);

    let typecheckSummary = 'skipped';
    let buildSummary = 'skipped';
    let testSummary = 'skipped';

    // 1. Typecheck
    if (tasksToRun.includes('typecheck')) {
      const diag = await this.diagnosticService.runDiagnostics('typecheck', {
        customCwd: options.cwd,
        project,
      });
      const typecheckResult = 'tasks' in diag ? diag.tasks[0] : (diag as DiagnosticResult);
      if (typecheckResult && !typecheckResult.success && typecheckResult.status !== 'not_configured') {
        return {
          status: 'FAIL',
          failedStep: 'typecheck',
          summary: `typecheck: FAIL (${typecheckResult.errorCount || 1} error(s))`,
          typecheck: 'failed',
          build: 'skipped',
          tests: 'skipped',
          errors: typecheckResult.structuredErrors && typecheckResult.structuredErrors.length > 0
            ? typecheckResult.structuredErrors
            : [typecheckResult.summary || (typecheckResult.rawOutput ? typecheckResult.rawOutput.slice(0, 500) : 'Typecheck failed')],
        };
      }
      typecheckSummary = typecheckResult?.status === 'not_configured' ? 'skipped' : 'pass';
    }

    // 2. Build
    if (tasksToRun.includes('build')) {
      const diag = await this.diagnosticService.runDiagnostics('build', {
        customCwd: options.cwd,
        project,
      });
      const buildResult = 'tasks' in diag ? diag.tasks[0] : (diag as DiagnosticResult);
      if (buildResult && !buildResult.success && buildResult.status !== 'not_configured') {
        return {
          status: 'FAIL',
          failedStep: 'build',
          summary: `typecheck: ${typecheckSummary}, build: FAIL`,
          typecheck: typecheckSummary,
          build: 'failed',
          tests: 'skipped',
          errors: buildResult.structuredErrors && buildResult.structuredErrors.length > 0
            ? buildResult.structuredErrors
            : [buildResult.summary || (buildResult.rawOutput ? buildResult.rawOutput.slice(0, 500) : 'Build failed')],
        };
      }
      buildSummary = buildResult?.status === 'not_configured' ? 'skipped' : 'pass';
    }

    // 3. Tests
    if (tasksToRun.includes('test') && !options.skipTests) {
      const diag = await this.diagnosticService.runDiagnostics('test', {
        customCwd: options.cwd,
        project,
      });
      const testResult = 'tasks' in diag ? diag.tasks[0] : (diag as DiagnosticResult);
      if (testResult && !testResult.success && testResult.status !== 'not_configured') {
        return {
          status: 'FAIL',
          failedStep: 'test',
          summary: `typecheck: ${typecheckSummary}, build: ${buildSummary}, test: FAIL`,
          typecheck: typecheckSummary,
          build: buildSummary,
          tests: 'failed',
          errors: testResult.structuredErrors && testResult.structuredErrors.length > 0
            ? testResult.structuredErrors
            : [testResult.summary || (testResult.rawOutput ? testResult.rawOutput.slice(0, 500) : 'Test failed')],
        };
      }
      testSummary = testResult?.status === 'not_configured' ? 'skipped' : 'pass';
    }

    // 4. Git Status
    let gitInfo: VerifyChangesResult['git'];
    try {
      const status = await this.gitService.getStatus({ customCwd: options.cwd, project });
      const modified = status.summary?.modified || [];
      const staged = status.summary?.staged || [];
      const untracked = status.summary?.untracked || [];
      const allChanged = Array.from(new Set([...modified, ...staged, ...untracked]));
      gitInfo = {
        branch: status.branch,
        changedFiles: allChanged.length,
        modified: modified.length,
        staged: staged.length,
        untracked: untracked.length,
        files: allChanged.slice(0, 20),
      };
    } catch {
      gitInfo = {
        changedFiles: 0,
        modified: 0,
        staged: 0,
        untracked: 0,
        files: [],
      };
    }

    return {
      status: 'PASS',
      summary: `PASS (typecheck: ${typecheckSummary}, build: ${buildSummary}, tests: ${testSummary}, changed: ${gitInfo.changedFiles} files)`,
      typecheck: typecheckSummary,
      build: buildSummary,
      tests: testSummary,
      git: gitInfo,
    };
  }

  /**
   * Status -> Stage -> Commit -> Push in a single roundtrip.
   */
  public async commitAndPush(options: CommitAndPushOptions): Promise<CommitAndPushResult> {
    if (!options.message || !options.message.trim()) {
      throw new Error('Commit message is required.');
    }
    const project = options.project || this.projectService?.getActiveProject(options.sessionId)?.name;

    // 1. Check status
    const status = await this.gitService.getStatus({ customCwd: options.cwd, project });
    const modified = status.summary?.modified || [];
    const untracked = status.summary?.untracked || [];
    const staged = status.summary?.staged || [];
    const totalChanges = modified.length + untracked.length + staged.length;

    if (totalChanges === 0) {
      return {
        status: 'clean',
        message: 'Working tree is clean, nothing to commit or push.',
        summary: 'Working tree is clean, nothing to commit or push.',
        branch: status.branch,
      };
    }

    // 2. Stage changes
    const filesToStage = options.files && options.files.length > 0 ? options.files : ['.'];
    await this.gitService.stage(filesToStage, { customCwd: options.cwd, project });

    // 3. Commit
    const commitRes = await this.gitService.commit({
      message: options.message.trim(),
      files: filesToStage,
      customCwd: options.cwd,
      project,
    });

    if (!commitRes.success) {
      return {
        status: 'error',
        error: commitRes.error || 'Git commit failed',
        summary: `Git commit failed: ${commitRes.error || 'unknown error'}`,
      };
    }

    // 4. Push (if requested or default true)
    const shouldPush = options.push !== false;
    if (!shouldPush) {
      return {
        status: 'success',
        commitHash: commitRes.commitHash,
        message: options.message.trim(),
        branch: status.branch || 'main',
        pushed: false,
        filesCommitted: commitRes.filesCommitted || [],
        summary: `Committed ${commitRes.commitHash} on ${status.branch || 'main'} (push skipped)`,
      };
    }

    try {
      const targetBranch = options.branch || status.branch || 'main';
      const remote = options.remote || 'origin';

      if (this.processService) {
        const cwd = options.cwd || (project && this.projectService ? this.projectService.resolveWorkingDir(options.cwd, project) : process.cwd());
        const pushRes = await this.processService.runCommand({
          command: `git push ${remote} ${targetBranch}`,
          cwd,
          projectName: project,
        });

        if (pushRes.exitCode !== 0) {
          throw new Error(`Git push failed: ${pushRes.stderr || pushRes.stdout}`);
        }
      }

      return {
        status: 'success',
        commitHash: commitRes.commitHash,
        message: options.message.trim(),
        branch: targetBranch,
        pushed: true,
        filesCommitted: commitRes.filesCommitted || [],
        summary: `Committed ${commitRes.commitHash} and pushed to ${remote}/${targetBranch}`,
      };
    } catch (pushErr: any) {
      return {
        status: 'error',
        commitHash: commitRes.commitHash,
        message: options.message.trim(),
        branch: status.branch || 'main',
        pushed: false,
        error: `Committed locally (${commitRes.commitHash}) but git push failed: ${pushErr?.message || String(pushErr)}`,
        summary: `Committed locally (${commitRes.commitHash}) but git push failed: ${pushErr?.message || String(pushErr)}`,
      };
    }
  }
}
