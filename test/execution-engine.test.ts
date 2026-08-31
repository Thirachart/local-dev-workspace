import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PtyRunner } from '../src/execution/ptyRunner.js';
import { CodexRunner } from '../src/execution/codexRunner.js';
import { DiagnosticParser } from '../src/execution/diagParser.js';
import { DiagnosticBaselineManager } from '../src/execution/diagnosticBaseline.js';

describe('Task 6: Execution Engine (ConPTY, Codex Guard, Diagnostics)', () => {
  const testDir = path.resolve(process.cwd(), `tmp-exec-engine-${Date.now()}`);

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('Check 1: PtyRunner spawns interactive shell and captures output', async () => {
    const runner = new PtyRunner();
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const exec = isWindows ? 'powershell.exe' : (isMac ? '/bin/echo' : 'echo');
    const args = isWindows ? ['-NoProfile', '-Command', 'Write-Output "PTY_TEST_OK"'] : ['PTY_TEST_OK'];

    const res = await runner.runPty({ executable: exec, args, cwd: testDir });
    assert.ok(res.transcript.includes('PTY_TEST_OK'));
  });

  it('Check 2: DiagnosticParser preserves unparsedRelevantLines when exitCode !== 0', () => {
    const parser = new DiagnosticParser();
    const rawOutput = 'Fatal custom runtime crash: unable to locate dependency DLL';
    const res = parser.parseOutput(rawOutput, 'dotnet build', 1);

    assert.strictEqual(res.passed, false);
    assert.strictEqual(res.errors.length, 0); // Unparsed by MSBuild regex
    assert.ok(res.unparsedRelevantLines.length > 0, 'unparsedRelevantLines MUST not be empty on nonzero exit');
    assert.ok(res.unparsedRelevantLines[0].includes('Fatal custom runtime crash'));
  });

  it('Check 3: DiagnosticBaselineManager suppresses existing baseline warnings', () => {
    const manager = new DiagnosticBaselineManager();
    const parser = new DiagnosticParser();

    const rawOutput = `
      src/app.ts(10,5): warning TS6133: 'unused' is declared but its value is never read.
      src/app.ts(20,5): warning TS6133: 'temp' is declared but its value is never read.
    `;
    const res1 = parser.parseOutput(rawOutput, 'tsc', 0);
    assert.strictEqual(res1.warnings.length, 2);

    // Create baseline
    const baseline = manager.createBaseline('typecheck', res1.warnings);
    assert.strictEqual(baseline.warningCount, 2);

    // Next run with same warnings + 1 new warning
    const rawOutput2 = `
      src/app.ts(10,5): warning TS6133: 'unused' is declared but its value is never read.
      src/app.ts(20,5): warning TS6133: 'temp' is declared but its value is never read.
      src/app.ts(30,5): warning TS7006: Parameter 'x' implicitly has an 'any' type.
    `;
    const res2 = parser.parseOutput(rawOutput2, 'tsc', 0);
    assert.strictEqual(res2.warnings.length, 3);

    const filtered = manager.filterAgainstBaseline(baseline.baselineId, res2.warnings);
    assert.strictEqual(filtered.suppressedCount, 2);
    assert.strictEqual(filtered.newWarnings.length, 1);
    assert.strictEqual(filtered.newWarnings[0].code, 'TS7006');
  });
});
