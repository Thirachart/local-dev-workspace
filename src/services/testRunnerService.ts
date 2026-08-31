import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ProcessService } from './processService.js';
import { ProjectService } from './projectService.js';

export interface TestFailureDetail {
  file?: string;
  testName?: string;
  line?: number;
  message: string;
}

export interface TestRunResult {
  status: 'passed' | 'failed' | 'error' | 'not_configured';
  framework: string;
  command: string | null;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  failures: TestFailureDetail[];
  summary: string;
  stdout: string;
  stderr: string;
}

export class TestRunnerService {
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

  public detectFramework(cwd: string): { framework: string; command: string | null } {
    // 1. Node.js / JavaScript / TypeScript
    const pkgJsonPath = path.join(cwd, 'package.json');
    if (fsSync.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(pkgJsonPath, 'utf-8'));
        const testScript = pkg.scripts?.test;
        if (testScript) {
          if (testScript.includes('vitest')) return { framework: 'vitest', command: 'npm test' };
          if (testScript.includes('jest')) return { framework: 'jest', command: 'npm test' };
          if (testScript.includes('mocha')) return { framework: 'mocha', command: 'npm test' };
          if (testScript.includes('node --test')) return { framework: 'node:test', command: 'npm test' };
          return { framework: 'npm:test', command: 'npm test' };
        }
      } catch {}
      return { framework: 'npm', command: null };
    }

    // 2. Python (pytest / unittest)
    if (
      fsSync.existsSync(path.join(cwd, 'pytest.ini')) ||
      fsSync.existsSync(path.join(cwd, 'pyproject.toml')) ||
      fsSync.existsSync(path.join(cwd, 'setup.cfg')) ||
      fsSync.existsSync(path.join(cwd, 'conftest.py'))
    ) {
      return { framework: 'pytest', command: 'pytest -v' };
    }
    if (fsSync.existsSync(path.join(cwd, 'requirements.txt')) || fsSync.existsSync(path.join(cwd, 'manage.py'))) {
      return { framework: 'python:unittest', command: 'python -m unittest' };
    }

    // 3. Go
    if (fsSync.existsSync(path.join(cwd, 'go.mod'))) {
      return { framework: 'gotest', command: 'go test -v ./...' };
    }

    // 4. Rust
    if (fsSync.existsSync(path.join(cwd, 'Cargo.toml'))) {
      return { framework: 'cargo:test', command: 'cargo test' };
    }

    // 5. Java / Kotlin
    if (fsSync.existsSync(path.join(cwd, 'pom.xml'))) {
      return { framework: 'maven:test', command: 'mvn test' };
    }
    if (fsSync.existsSync(path.join(cwd, 'build.gradle')) || fsSync.existsSync(path.join(cwd, 'build.gradle.kts'))) {
      return { framework: 'gradle:test', command: './gradlew test' };
    }

    // 6. PHP
    if (fsSync.existsSync(path.join(cwd, 'phpunit.xml')) || fsSync.existsSync(path.join(cwd, 'composer.json'))) {
      return { framework: 'phpunit', command: 'vendor/bin/phpunit' };
    }

    // Fallback default
    return { framework: 'generic', command: null };
  }

  public detectFrameworkFromCommand(command: string): { framework: string; command: string } {
    const normalized = command.trim();
    const executableMatch = normalized.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const executablePath = executableMatch?.[1] || executableMatch?.[2] || executableMatch?.[3] || '';
    const executableName = executablePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
    const isPythonLauncher = /^(?:py|python\d*(?:\.\d+)*)(?:\.exe)?$/i.test(executableName);
    const isUnittestModule = /(?:^|\s)-m\s+unittest(?:\s|$)/i.test(normalized);

    if (isPythonLauncher && isUnittestModule) {
      return { framework: 'unittest', command: normalized };
    }
    return { framework: 'custom', command: normalized };
  }

  public parseOutput(output: string, framework: string): {
    passed: number;
    failed: number;
    skipped: number;
    failures: TestFailureDetail[];
  } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures: TestFailureDetail[] = [];

    const lines = output.split(/\r?\n/);

    if (framework === 'unittest' || framework === 'python:unittest') {
      const ranMatch = output.match(/\bRan\s+(\d+)\s+tests?\b/i);
      const failedSummary = output.match(/\bFAILED\b(?:\s*\(([^)]*)\))?/i);
      const okSummary = /(?:^|\n)\s*OK(?:\s|\(|$)/i.test(output);
      if (!ranMatch && !failedSummary && !okSummary) {
        return { passed: 0, failed: 0, skipped: 0, failures: [] };
      }

      const total = ranMatch ? Number(ranMatch[1]) : 0;
      const failuresCount = Number(output.match(/\bfailures=(\d+)\b/i)?.[1] || 0);
      const errorsCount = Number(output.match(/\berrors=(\d+)\b/i)?.[1] || 0);
      skipped = Number(output.match(/\bskipped=(\d+)\b/i)?.[1] || 0);
      failed = failuresCount + errorsCount;
      passed = Math.max(total - failed - skipped, 0);

      if (failed > 0) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/FAIL|ERROR|AssertionError/.test(line)) {
            failures.push({ message: line.trim(), line: i + 1 });
            if (failures.length >= 5) break;
          }
        }
      }

      return { passed, failed, skipped, failures };
    }

    // 1. Node TAP / node:test parser (e.g. "ok 1 - test name", "not ok 2 - test name")
    let inNodeTap = false;
    for (const line of lines) {
      const matchOk = line.match(/^ok\s+\d+\s+-\s+(.+)/);
      const matchNotOk = line.match(/^not ok\s+\d+\s+-\s+(.+)/);
      if (matchOk) {
        passed++;
        inNodeTap = true;
      } else if (matchNotOk) {
        failed++;
        inNodeTap = true;
        failures.push({
          testName: matchNotOk[1].trim(),
          message: `Test failed: ${matchNotOk[1].trim()}`,
        });
      }
    }

    // 2. Vitest / Jest Summary parser (e.g. "Tests  5 passed, 1 failed, 6 total")
    const vitestMatch = output.match(/Tests\s+((?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+skipped,?\s*)?\(?(\d+)\s+total\)?)/i);
    if (vitestMatch && !inNodeTap) {
      const failedMatch = output.match(/(\d+)\s+failed/i);
      const passedMatch = output.match(/(\d+)\s+passed/i);
      const skippedMatch = output.match(/(\d+)\s+skipped/i);
      failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
      passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
      skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
    }

    // 3. Pytest Parser (e.g. "==== 5 passed, 2 failed, 1 skipped in 1.23s ====")
    const pytestMatch = output.match(/=+\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+skipped,?\s*)?in\s+[\d\.]+s\s+=+/i);
    if (pytestMatch) {
      const failedM = output.match(/(\d+)\s+failed/i);
      const passedM = output.match(/(\d+)\s+passed/i);
      const skippedM = output.match(/(\d+)\s+skipped/i);
      failed = failedM ? parseInt(failedM[1], 10) : 0;
      passed = passedM ? parseInt(passedM[1], 10) : 0;
      skipped = skippedM ? parseInt(skippedM[1], 10) : 0;
    }

    // 4. Cargo / Go / Generic Parser Fallback
    if (passed === 0 && failed === 0) {
      const cargoMatch = output.match(/test result:\s+(ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/i);
      if (cargoMatch) {
        passed = parseInt(cargoMatch[2], 10);
        failed = parseInt(cargoMatch[3], 10);
        skipped = parseInt(cargoMatch[4], 10);
      } else {
        const passCountMatch = output.match(/(\d+)\s+(?:tests?\s+)?passed/i);
        const failCountMatch = output.match(/(\d+)\s+(?:tests?\s+)?failed/i);
        if (passCountMatch) passed = parseInt(passCountMatch[1], 10);
        if (failCountMatch) failed = parseInt(failCountMatch[1], 10);
      }
    }

    // Extract failure locations if available
    if (failures.length === 0 && failed > 0) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.includes('FAIL') || l.includes('Error:') || l.includes('AssertionError')) {
          failures.push({
            message: l.trim(),
            line: i + 1,
          });
          if (failures.length >= 5) break;
        }
      }
    }

    return { passed, failed, skipped, failures };
  }

  public async runTests(options?: {
    customCommand?: string;
    testFilter?: string;
    customCwd?: string;
    project?: string;
    timeoutMs?: number;
  }): Promise<TestRunResult> {
    const cwd = this.resolveCwd(options?.customCwd, options?.project);
    const detected = options?.customCommand
      ? this.detectFrameworkFromCommand(options.customCommand)
      : this.detectFramework(cwd);
    let command = options?.customCommand || detected.command;

    if (!command) {
      return {
        status: 'not_configured',
        framework: detected.framework,
        command: null,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        durationMs: 0,
        failures: [],
        summary: 'Tests not configured: no test framework or test command was detected.',
        stdout: '',
        stderr: '',
      };
    }

    if (options?.testFilter && !options?.customCommand) {
      if (detected.framework === 'vitest' || detected.framework === 'jest') {
        command += ` -t "${options.testFilter}"`;
      } else if (detected.framework === 'pytest') {
        command += ` -k "${options.testFilter}"`;
      } else if (detected.framework === 'gotest') {
        command += ` -run "${options.testFilter}"`;
      } else if (detected.framework === 'cargo:test') {
        command += ` ${options.testFilter}`;
      }
    }

    const startTime = Date.now();
    const execRes = await this.processService.runCommand({
      command,
      cwd,
      timeoutMs: options?.timeoutMs || 60000,
      projectName: options?.project,
    });
    const durationMs = Date.now() - startTime;

    const fullOutput = `${execRes.stdout}\n${execRes.stderr}`;
    const parsed = this.parseOutput(fullOutput, detected.framework);
    const isSuccess = execRes.exitCode === 0;

    let status: 'passed' | 'failed' | 'error' = isSuccess ? 'passed' : 'failed';
    if (execRes.exitCode !== 0 && parsed.passed === 0 && parsed.failed === 0) {
      status = 'error';
    }

    const total = parsed.passed + parsed.failed + parsed.skipped;
    const summary = status === 'passed'
      ? `✅ All tests passed (${parsed.passed || total} passed in ${durationMs}ms)`
      : `❌ Tests failed (${parsed.failed} failed, ${parsed.passed} passed in ${durationMs}ms)`;

    return {
      status,
      framework: detected.framework,
      command,
      passed: parsed.passed,
      failed: parsed.failed,
      skipped: parsed.skipped,
      total,
      durationMs,
      failures: parsed.failures,
      summary,
      stdout: execRes.stdout.slice(-2000), // Keep last 2000 chars to save tokens
      stderr: execRes.stderr.slice(-2000),
    };
  }
}
