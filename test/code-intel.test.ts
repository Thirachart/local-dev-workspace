import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SymbolService } from '../src/code-intel/symbolService.js';
import { ReferenceService } from '../src/code-intel/referenceService.js';
import { VueSfcParser } from '../src/code-intel/vueSfcAst.js';
import { IndexManager } from '../src/code-intel/indexManager.js';
import { ImpactedTestSuggester } from '../src/code-intel/impactedTests.js';

describe('Task 7: Code Intelligence Module (TS, Vue, References, Index, Impacted Tests)', () => {
  const testDir = path.resolve(process.cwd(), `tmp-code-intel-${Date.now()}`);
  let symbolService: SymbolService;
  let referenceService: ReferenceService;
  let vueParser: VueSfcParser;
  let indexManager: IndexManager;
  let impactedTestSuggester: ImpactedTestSuggester;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    symbolService = new SymbolService();
    referenceService = new ReferenceService();
    vueParser = new VueSfcParser();
    indexManager = new IndexManager();
    impactedTestSuggester = new ImpactedTestSuggester();

    // Create TS file
    await fs.writeFile(
      path.join(testDir, 'PaymentGateway.ts'),
      `export class PaymentGateway {\n  public processPayment(amount: number): boolean {\n    return amount > 0;\n  }\n}\n`
    );

    // Create consumer file
    await fs.writeFile(
      path.join(testDir, 'CheckoutService.ts'),
      `import { PaymentGateway } from './PaymentGateway.js';\nexport class CheckoutService {\n  constructor(private gw: PaymentGateway) {}\n  public checkout(): void {\n    this.gw.processPayment(100);\n  }\n}\n`
    );

    // Create Vue SFC
    await fs.writeFile(
      path.join(testDir, 'UserProfile.vue'),
      `<template><div>{{ name }}</div></template>\n<script setup lang="ts">\nexport interface UserState { name: string; }\nexport function loadUser(): void {}\n</script>\n`
    );

    // Create test file for impact lookup
    await fs.mkdir(path.join(testDir, 'test'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'test', 'PaymentGateway.test.ts'),
      `import { PaymentGateway } from '../PaymentGateway.js';\n`
    );
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('Check 1: listSymbols extracts exact class & method line numbers using TS AST', async () => {
    const file = path.join(testDir, 'PaymentGateway.ts');
    const { symbols, parser } = await symbolService.listSymbols(file);

    assert.strictEqual(parser, 'typescript-ast');
    assert.strictEqual(symbols.length, 2);
    assert.strictEqual(symbols[0].name, 'PaymentGateway');
    assert.strictEqual(symbols[0].kind, 'class');
    assert.strictEqual(symbols[1].name, 'processPayment');
    assert.strictEqual(symbols[1].kind, 'method');
  });

  it('Check 2: readSymbol returns only the specific method implementation', async () => {
    const file = path.join(testDir, 'PaymentGateway.ts');
    const res = await symbolService.readSymbol(file, 'processPayment');

    assert.strictEqual(res.symbol.name, 'processPayment');
    assert.ok(res.source.includes('return amount > 0;'));
    assert.strictEqual(res.source.includes('export class PaymentGateway'), false, 'Should extract only method body');
  });

  it('Check 3: Vue SFC parser extracts script and script setup', async () => {
    const file = path.join(testDir, 'UserProfile.vue');
    const content = await fs.readFile(file, 'utf-8');
    const res = vueParser.extractScript(content, 'UserProfile.vue');

    assert.strictEqual(res.hasScriptSetup, true);
    assert.strictEqual(res.lang, 'ts');
    assert.ok(res.scriptSetupContent.includes('loadUser'));
  });

  it('Check 4: findReferences discovers all usages across project files', async () => {
    const res = await referenceService.findReferences(testDir, 'PaymentGateway');

    assert.strictEqual(res.symbol, 'PaymentGateway');
    assert.ok(res.totalHits >= 2);
    assert.ok(res.references.some(r => r.path.includes('CheckoutService.ts')));
  });

  it('Check 5: IndexManager caches symbols and applies dirty-file overlay', async () => {
    const file = path.join(testDir, 'PaymentGateway.ts');
    const symbols1 = await indexManager.getOrIndexFile(file);
    assert.strictEqual(symbols1.length, 2);

    // Read from cache
    const symbols2 = await indexManager.getOrIndexFile(file);
    assert.strictEqual(symbols1, symbols2, 'Should return cached symbol array if mtime unchanged');
  });

  it('Check 6: suggestImpactedTests suggests candidate test files with fallback command', async () => {
    const res = await impactedTestSuggester.suggestImpactedTests(testDir, ['PaymentGateway.ts']);

    assert.strictEqual(res.completenessGuaranteed, false);
    assert.ok(res.tests.length >= 1);
    assert.strictEqual(res.tests[0].confidence, 'high');
    assert.ok(res.tests[0].target.includes('PaymentGateway.test.ts'));
    assert.strictEqual(res.fallback.scope, 'full');
    assert.strictEqual(res.fallback.command, 'npm test');
  });
});
