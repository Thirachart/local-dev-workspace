import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export interface ImpactedTest {
  target: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface ImpactedTestsResult {
  completenessGuaranteed: false;
  tests: ImpactedTest[];
  fallback: {
    command: string;
    scope: 'full';
  };
}

export class ImpactedTestSuggester {
  public async suggestImpactedTests(
    baseDir: string,
    changedFiles: string[],
    options?: { testFramework?: 'vitest' | 'jest' | 'dotnet' | 'node-test' }
  ): Promise<ImpactedTestsResult> {
    const tests: ImpactedTest[] = [];
    const testDir = path.join(baseDir, 'test');
    const testsDir = path.join(baseDir, 'tests');

    // Find all test files
    const testFiles: string[] = [];
    const scan = async (dir: string) => {
      if (!fsSync.existsSync(dir)) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (
            lower.includes('.test.') ||
            lower.includes('.spec.') ||
            lower.endsWith('test.ts') ||
            lower.endsWith('tests.cs')
          ) {
            testFiles.push(path.relative(baseDir, full).replace(/\\/g, '/'));
          }
        }
      }
    };

    await scan(testDir);
    await scan(testsDir);
    await scan(baseDir);

    for (const changed of changedFiles) {
      const normalizedChanged = changed.replace(/\\/g, '/');
      const basename = path.basename(normalizedChanged, path.extname(normalizedChanged));

      // 1. Direct Name Match (e.g. envelope.ts -> core-envelope.test.ts or envelope.test.ts)
      for (const t of testFiles) {
        const tBase = path.basename(t);
        if (tBase.toLowerCase().includes(basename.toLowerCase())) {
          tests.push({
            target: t,
            confidence: 'high',
            reasons: [`Direct filename match for changed file: ${changed}`],
          });
        }
      }

      // 2. Module / Directory Proximity Match
      const changedDir = path.dirname(normalizedChanged);
      for (const t of testFiles) {
        if (tests.some(existing => existing.target === t)) continue;
        if (path.dirname(t) === changedDir || t.includes(path.basename(changedDir))) {
          tests.push({
            target: t,
            confidence: 'medium',
            reasons: [`Same module directory proximity (${changedDir})`],
          });
        }
      }
    }

    // Determine fallback command
    let fallbackCmd = 'npm test';
    if (fsSync.existsSync(path.join(baseDir, 'package.json'))) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(baseDir, 'package.json'), 'utf-8'));
        if (pkg.scripts?.test) fallbackCmd = 'npm test';
      } catch {}
    }

    return {
      completenessGuaranteed: false,
      tests,
      fallback: {
        command: fallbackCmd,
        scope: 'full',
      },
    };
  }
}
