import path from 'node:path';
import { ProcessService } from './processService.js';
import { ProjectService } from './projectService.js';

export interface DiagnosticItem {
  filePath: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  code?: string;
  message: string;
  sourceCompiler?: 'msbuild' | 'tsc' | 'eslint' | 'test' | 'generic';
}

export interface DiagnosticReport {
  success: boolean;
  cleanBuild: boolean;
  totalErrors: number;
  totalWarnings: number;
  diagnostics: DiagnosticItem[];
  unparsedRelevantLines: string[];
  durationMs: number;
  commandExecuted?: string;
}

export class DiagnosticParserService {
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

  public parseDiagnosticsText(rawOutput: string, baseDir: string = this.baseDir): {
    diagnostics: DiagnosticItem[];
    unparsedRelevantLines: string[];
    totalErrors: number;
    totalWarnings: number;
  } {
    const lines = rawOutput.split(/\r?\n/);
    const diagnostics: DiagnosticItem[] = [];
    const unparsedRelevantLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let matched = false;

      // 1. MSBuild / C# Diagnostic: e.g. "Services\Coordinator.cs(123,45): error CS0246: The type..."
      // Or "Services/Coordinator.cs(123,45): warning CS8618: Non-nullable..."
      const msbuildMatch = line.match(/^([A-Za-z0-9_./\\ -]+)\((\d+)(?:,(\d+))?\):\s*(error|warning|info)\s+([A-Za-z0-9_]+):\s*(.+)$/i);
      if (msbuildMatch) {
        matched = true;
        const relPath = path.relative(baseDir, path.resolve(baseDir, msbuildMatch[1])).replace(/\\/g, '/');
        const severity = msbuildMatch[4].toLowerCase() as DiagnosticItem['severity'];
        diagnostics.push({
          filePath: relPath,
          line: parseInt(msbuildMatch[2], 10),
          column: msbuildMatch[3] ? parseInt(msbuildMatch[3], 10) : undefined,
          severity: severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info',
          code: msbuildMatch[5],
          message: msbuildMatch[6].trim(),
          sourceCompiler: 'msbuild',
        });
        continue;
      }

      // 2. TypeScript / TSC: e.g. "src/index.ts:45:12 - error TS2304: Cannot find name..."
      // Or "src/index.ts(45,12): error TS2304: Cannot find name..."
      const tscMatch1 = line.match(/^([A-Za-z0-9_./\\ -]+):(\d+):(\d+)\s*-\s*(error|warning)\s+([A-Za-z0-9_]+):\s*(.+)$/i);
      if (tscMatch1) {
        matched = true;
        const relPath = path.relative(baseDir, path.resolve(baseDir, tscMatch1[1])).replace(/\\/g, '/');
        diagnostics.push({
          filePath: relPath,
          line: parseInt(tscMatch1[2], 10),
          column: parseInt(tscMatch1[3], 10),
          severity: tscMatch1[4].toLowerCase() === 'error' ? 'error' : 'warning',
          code: tscMatch1[5],
          message: tscMatch1[6].trim(),
          sourceCompiler: 'tsc',
        });
        continue;
      }

      const tscMatch2 = line.match(/^([A-Za-z0-9_./\\ -]+)\((\d+),(\d+)\):\s*error\s+([A-Za-z0-9_]+):\s*(.+)$/i);
      if (tscMatch2) {
        matched = true;
        const relPath = path.relative(baseDir, path.resolve(baseDir, tscMatch2[1])).replace(/\\/g, '/');
        diagnostics.push({
          filePath: relPath,
          line: parseInt(tscMatch2[2], 10),
          column: parseInt(tscMatch2[3], 10),
          severity: 'error',
          code: tscMatch2[4],
          message: tscMatch2[5].trim(),
          sourceCompiler: 'tsc',
        });
        continue;
      }

      // 3. ESLint: "  12:5  error  'foo' is defined but never used  @typescript-eslint/no-unused-vars"
      const eslintMatch = line.match(/^(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+([@A-Za-z0-9_-]+))?$/i);
      if (eslintMatch) {
        matched = true;
        diagnostics.push({
          filePath: 'current-file',
          line: parseInt(eslintMatch[1], 10),
          column: parseInt(eslintMatch[2], 10),
          severity: eslintMatch[3].toLowerCase() === 'error' ? 'error' : 'warning',
          code: eslintMatch[5],
          message: eslintMatch[4].trim(),
          sourceCompiler: 'eslint',
        });
        continue;
      }

      // If line wasn't parsed into standard structured diagnostic, check if it contains failure keywords
      if (!matched) {
        const lower = line.toLowerCase();
        if (
          lower.includes('error') ||
          lower.includes('fatal') ||
          lower.includes('failed') ||
          lower.includes('exception') ||
          lower.includes('cannot find') ||
          lower.includes('build failed')
        ) {
          if (unparsedRelevantLines.length < 30) {
            unparsedRelevantLines.push(line);
          }
        }
      }
    }

    const totalErrors = diagnostics.filter((d) => d.severity === 'error').length;
    const totalWarnings = diagnostics.filter((d) => d.severity === 'warning').length;

    return {
      diagnostics,
      unparsedRelevantLines,
      totalErrors,
      totalWarnings,
    };
  }

  public async runBuildDiagnostics(options?: {
    customCommand?: string;
    target?: 'dotnet' | 'tsc' | 'custom';
    customCwd?: string;
    project?: string;
  }): Promise<DiagnosticReport> {
    const cwd = this.resolveCwd(options?.customCwd, options?.project);
    let command = options?.customCommand;

    if (!command) {
      if (options?.target === 'tsc') {
        command = 'npx tsc --noEmit';
      } else {
        command = 'dotnet build --no-restore';
      }
    }

    const start = Date.now();
    const result = await this.processService.runCommand({
      command,
      cwd,
      timeoutMs: 120000,
      projectName: options?.project,
    });
    const durationMs = Date.now() - start;

    const fullOutput = `${result.stdout}\n${result.stderr}`.trim();
    const parsed = this.parseDiagnosticsText(fullOutput, cwd);

    const isClean = result.exitCode === 0 && parsed.totalErrors === 0 && parsed.unparsedRelevantLines.length === 0;

    return {
      success: result.exitCode === 0,
      cleanBuild: isClean,
      totalErrors: parsed.totalErrors,
      totalWarnings: parsed.totalWarnings,
      diagnostics: parsed.diagnostics,
      unparsedRelevantLines: parsed.unparsedRelevantLines,
      durationMs,
      commandExecuted: command,
    };
  }
}
