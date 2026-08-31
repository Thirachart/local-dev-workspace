import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ProcessService } from './processService.js';
import { ProjectService } from './projectService.js';

export interface DiagnosticError {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface DiagnosticResult {
  task: string;
  status: 'passed' | 'failed' | 'not_configured';
  success: boolean;
  projectType: string;
  commandRun: string | null;
  exitCode: number | null;
  durationMs: number;
  errorCount: number;
  warningCount: number;
  structuredErrors: DiagnosticError[];
  summary: string;
  rawOutput: string;
}

export class DiagnosticService {
  private processService: ProcessService;
  private projectService?: ProjectService;
  private baseDir: string;

  constructor(processService: ProcessService, baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.processService = processService;
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  private resolveCwd(customCwd?: string, projectName?: string): string {
    if (this.projectService) {
      return this.projectService.resolveWorkingDir(customCwd, projectName);
    }
    if (!customCwd) return this.baseDir;
    if (path.isAbsolute(customCwd)) return path.resolve(customCwd);
    return path.resolve(this.baseDir, customCwd);
  }

  public detectProjectType(cwd: string): { type: string; scripts: Record<string, string> } {
    const pkgPath = path.join(cwd, 'package.json');
    if (fsSync.existsSync(pkgPath)) {
      try {
        const raw = fsSync.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw);
        return {
          type: 'node',
          scripts: pkg.scripts || {},
        };
      } catch {
        return { type: 'node', scripts: {} };
      }
    }

    if (fsSync.existsSync(path.join(cwd, 'Cargo.toml'))) {
      return { type: 'rust', scripts: {} };
    }
    if (fsSync.existsSync(path.join(cwd, 'go.mod'))) {
      return { type: 'go', scripts: {} };
    }
    if (fsSync.existsSync(path.join(cwd, 'pyproject.toml')) || fsSync.existsSync(path.join(cwd, 'requirements.txt'))) {
      return { type: 'python', scripts: {} };
    }

    return { type: 'generic', scripts: {} };
  }

  public async runDiagnostics(
    task: 'typecheck' | 'lint' | 'test' | 'build' | 'all',
    options?: { customCwd?: string; project?: string; command?: string }
  ): Promise<DiagnosticResult | { tasks: DiagnosticResult[]; overallSuccess: boolean }> {
    const cwd = this.resolveCwd(options?.customCwd, options?.project);
    const { type, scripts } = this.detectProjectType(cwd);

    if (task === 'all') {
      const tasksToRun: Array<'typecheck' | 'lint' | 'test' | 'build'> = ['typecheck', 'lint', 'test', 'build'];
      const results: DiagnosticResult[] = [];
      let allPassed = true;

      for (const t of tasksToRun) {
        const res = (await this.runSingleTask(t, cwd, type, scripts, options?.project, options?.command)) as DiagnosticResult;
        results.push(res);
        if (!res.success) {
          allPassed = false;
        }
      }

      return {
        tasks: results,
        overallSuccess: allPassed,
      };
    }

    return this.runSingleTask(task, cwd, type, scripts, options?.project, options?.command);
  }

  private async runSingleTask(
    task: 'typecheck' | 'lint' | 'test' | 'build',
    cwd: string,
    projectType: string,
    scripts: Record<string, string>,
    project?: string,
    customCommand?: string
  ): Promise<DiagnosticResult> {
    let command = customCommand || '';

    // Explicit command always wins over project auto-detection.
    // This allows callers (the AI agent) to select the project's own toolchain.
    if (!command) {
      if (projectType === 'node') {
        switch (task) {
          case 'typecheck':
            if (scripts.typecheck) command = 'npm run typecheck';
            else if (scripts['check-types']) command = 'npm run check-types';
            else if (fsSync.existsSync(path.join(cwd, 'tsconfig.json'))) command = 'npx tsc --noEmit';
            break;
          case 'lint':
            if (scripts.lint) {
              command = 'npm run lint';
            } else {
              const hasEslintConfig =
                fsSync.existsSync(path.join(cwd, 'eslint.config.js')) ||
                fsSync.existsSync(path.join(cwd, 'eslint.config.mjs')) ||
                fsSync.existsSync(path.join(cwd, 'eslint.config.cjs')) ||
                fsSync.existsSync(path.join(cwd, '.eslintrc.js')) ||
                fsSync.existsSync(path.join(cwd, '.eslintrc.cjs')) ||
                fsSync.existsSync(path.join(cwd, '.eslintrc.json')) ||
                fsSync.existsSync(path.join(cwd, '.eslintrc.yml')) ||
                fsSync.existsSync(path.join(cwd, '.eslintrc.yaml')) ||
                fsSync.existsSync(path.join(cwd, '.eslintrc'));
              if (hasEslintConfig) command = 'npx eslint .';
            }
            break;
          case 'test':
            if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') command = 'npm test';
            break;
          case 'build':
            if (scripts.build) command = 'npm run build';
            break;
        }
      } else if (projectType === 'rust') {
        switch (task) {
          case 'typecheck':
          case 'build': command = 'cargo check'; break;
          case 'lint': command = 'cargo clippy'; break;
          case 'test': command = 'cargo test'; break;
        }
      } else if (projectType === 'go') {
        switch (task) {
          case 'typecheck':
          case 'build': command = 'go build ./...'; break;
          case 'test': command = 'go test ./...'; break;
          case 'lint': command = 'golangci-lint run'; break;
        }
      }
    }

    if (!command) {
      return {
        task,
        status: 'not_configured',
        success: false,
        projectType,
        commandRun: null,
        exitCode: null,
        durationMs: 0,
        errorCount: 0,
        warningCount: 0,
        structuredErrors: [],
        summary: `Diagnostic '${task}' is not configured for ${projectType} project. Provide an explicit command from the project's own instructions or tool configuration.`,
        rawOutput: '',
      };
    }

    const start = Date.now();
    const result = await this.processService.runCommand({
      command,
      cwd,
      timeoutMs: 120000,
      projectName: project,
    });
    const durationMs = Date.now() - start;

    const fullOutput = `${result.stdout}\n${result.stderr}`.trim();
    const structuredErrors = this.parseErrors(fullOutput, projectType);
    const errorCount = structuredErrors.filter((e) => e.severity === 'error').length;
    const warningCount = structuredErrors.filter((e) => e.severity === 'warning').length;
    const isSuccess = result.exitCode === 0;

    let summary = '';
    if (isSuccess) {
      summary = `Diagnostic '${task}' PASSED (${durationMs}ms) with 0 errors.`;
    } else {
      summary = `Diagnostic '${task}' FAILED with exit code ${result.exitCode}. Found ${errorCount} error(s) and ${warningCount} warning(s).`;
    }

    return {
      task,
      status: isSuccess ? 'passed' : 'failed',
      success: isSuccess,
      projectType,
      commandRun: command,
      exitCode: result.exitCode ?? 1,
      durationMs,
      errorCount,
      warningCount,
      structuredErrors,
      summary,
      rawOutput: fullOutput.slice(0, 10000),
    };
  }

  private parseErrors(output: string, projectType: string): DiagnosticError[] {
    const errors: DiagnosticError[] = [];
    const lines = output.split(/\r?\n/);

    // TypeScript / ESLint regex patterns
    // e.g. src/index.ts:15:7 - error TS2304: Cannot find name 'x'.
    // e.g. src/index.ts(15,7): error TS2304: ...
    const tsRegex = /([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)(?:[:(](\d+)(?:[:,](\d+))?\)?)\s*[-:]?\s*(error|warning)\s*([A-Z0-9]+)?:\s*(.*)/i;
    // ESLint regex: 12:5  error  'foo' is defined but never used  no-unused-vars
    const eslintRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.*?)\s+([a-zA-Z0-9\-_/@]+)$/i;

    let currentFile = '';

    for (const line of lines) {
      // Check if line is a file header from eslint / pytest
      if (line.endsWith('.ts') || line.endsWith('.tsx') || line.endsWith('.js') || line.endsWith('.jsx')) {
        currentFile = line.trim();
      }

      const tsMatch = line.match(tsRegex);
      if (tsMatch) {
        errors.push({
          file: tsMatch[1]?.replace(/\\/g, '/'),
          line: parseInt(tsMatch[2], 10),
          column: tsMatch[3] ? parseInt(tsMatch[3], 10) : undefined,
          severity: tsMatch[4].toLowerCase() === 'warning' ? 'warning' : 'error',
          code: tsMatch[5] || undefined,
          message: tsMatch[6]?.trim() || line.trim(),
        });
        continue;
      }

      const eslintMatch = line.match(eslintRegex);
      if (eslintMatch) {
        errors.push({
          file: currentFile ? currentFile.replace(/\\/g, '/') : undefined,
          line: parseInt(eslintMatch[1], 10),
          column: parseInt(eslintMatch[2], 10),
          severity: eslintMatch[3].toLowerCase() === 'warning' ? 'warning' : 'error',
          message: eslintMatch[4]?.trim() || '',
          code: eslintMatch[5] || undefined,
        });
      }
    }

    return errors.slice(0, 50); // Cap to top 50
  }
}
