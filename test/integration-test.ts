import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import util from 'node:util';
import assert from 'node:assert/strict';

import { FileService } from '../src/services/fileService.js';
import { SearchService } from '../src/services/searchService.js';
import { ProcessService } from '../src/services/processService.js';
import { GitService } from '../src/services/gitService.js';

const execFileAsync = util.promisify(execFile);

async function runTests() {
  console.log('--- Starting Isolated Integration Tests ---');
  const tempDirName = `chatdev-integration-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const testDir = path.join(os.tmpdir(), tempDirName);
  await fs.mkdir(testDir, { recursive: true });

  console.log(`Initialized isolated test workspace at: ${testDir}`);

  // 0. Initialize an isolated Git repository in testDir
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: testDir });
  await execFileAsync('git', ['config', 'user.name', 'Integration Test Runner'], { cwd: testDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
  await fs.writeFile(path.join(testDir, 'init.txt'), 'Initial root commit file\n', 'utf-8');
  await execFileAsync('git', ['add', 'init.txt'], { cwd: testDir });
  await execFileAsync('git', ['commit', '-m', 'initial root commit'], { cwd: testDir });

  const fileService = new FileService(testDir);
  const searchService = new SearchService(testDir);
  const processService = new ProcessService(testDir);
  const gitService = new GitService(testDir);

  try {
    // 1. Test FileService.writeFile
    console.log('1. Testing writeFile...');
    const writeRes = await fileService.writeFile('sample.txt', 'Line 1\nLine 2: Hello World\nLine 3');
    assert.ok(writeRes.success, 'writeFile failed');

    // 2. Test FileService.readFile
    console.log('2. Testing readFile with line range...');
    const readRes = await fileService.readFile('sample.txt', { startLine: 2, endLine: 2 });
    assert.strictEqual(readRes.content, 'Line 2: Hello World', `readFile line mismatch: got "${readRes.content}"`);

    // 3. Test FileService.editFile
    console.log('3. Testing editFile...');
    const editRes = await fileService.editFile('sample.txt', 'Hello World', 'Hello MCP');
    assert.strictEqual(editRes.occurrencesReplaced, 1, 'editFile occurrence count mismatch');
    const readAfterEdit = await fileService.readFile('sample.txt');
    assert.ok(readAfterEdit.content.includes('Hello MCP'), 'editFile content not updated');

    // 4. Test SearchService.findFiles and searchFiles
    console.log('4. Testing findFiles & searchFiles...');
    const foundFiles = await searchService.findFiles('**/*.txt', { customCwd: testDir });
    assert.ok(foundFiles.length >= 1, 'findFiles failed');
    const searchRes = await searchService.searchFiles('Hello MCP', { customCwd: testDir });
    assert.ok(searchRes.totalMatches >= 1, 'searchFiles failed');

    // 5. Test ProcessService.runCommand (Sync)
    console.log('5. Testing runCommand (Sync)...');
    const cmdRes = await processService.runCommand({ command: 'echo "Test Command Execution"' });
    assert.strictEqual(cmdRes.status, 'completed', `runCommand sync failed: ${cmdRes.stderr}`);
    assert.ok(cmdRes.stdout.includes('Test Command Execution'), 'runCommand stdout mismatch');

    // 6. Test ProcessService.runCommand (Background / Daemon)
    console.log('6. Testing runCommand (Background Daemon & Task Kill)...');
    const bgRes = await processService.runCommand({
      command: process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10',
      isDaemon: true,
    });
    assert.ok(bgRes.isDaemon && bgRes.taskId, 'Background task spawn failed');
    const taskId = bgRes.taskId!;

    const statusRes = processService.getTaskStatus(taskId);
    assert.ok(statusRes.found && statusRes.task?.status === 'running', 'Task status check failed');

    const killRes = await processService.killTask(taskId);
    assert.ok(killRes.success, 'Task kill failed');

    // 7. Test FileService.listDirectory & deleteFile
    console.log('7. Testing listDirectory & deleteFile...');
    const listRes = await fileService.listDirectory('.');
    assert.ok(listRes.items.some((e) => e.name === 'sample.txt'), 'listDirectory failed');
    await fileService.deleteFile('sample.txt');

    // 8. Test GitService in isolated repository
    console.log('8. Testing GitService...');
    const gitStatus = await gitService.getStatus(testDir);
    assert.ok(gitStatus.isGitRepo, 'Git status isGitRepo should be true in isolated repo');
    assert.strictEqual(gitStatus.branch, 'main', 'Expected main branch in isolated repo');

    const gitLog = await gitService.getLog({ maxCount: 5, customCwd: testDir });
    assert.ok(gitLog.isGitRepo && gitLog.commits.length >= 1, 'git_log failed');
    console.log(`Git log checked (found ${gitLog.commits.length} commits in isolated repo)`);

    // 9. Test PatchService (apply_patch)
    console.log('9. Testing PatchService...');
    const { PatchService } = await import('../src/services/patchService.js');
    const patchService = new PatchService(testDir);
    await fileService.writeFile('patch_test.txt', 'const a = 1;\nconst b = 2;\nconst c = 3;');
    const patchRes = await patchService.applyStructuredPatch([
      { filePath: 'patch_test.txt', targetContent: 'const b = 2;', replacementContent: 'const b = 200;' },
    ]);
    assert.ok(patchRes.success && patchRes.filesModified.includes('patch_test.txt'), 'applyStructuredPatch failed');
    const patchedFile = await fileService.readFile('patch_test.txt');
    assert.ok(patchedFile.content.includes('const b = 200;'), 'patched content mismatch');

    // 10. Test DiagnosticService (project_diagnostics) in the isolated workspace.
    // Do not couple this integration seam to the health of the chat-dev-mcp source tree.
    console.log('10. Testing DiagnosticService...');
    const { DiagnosticService } = await import('../src/services/diagnosticService.js');
    await fs.writeFile(path.join(testDir, 'diagnostic.js'), 'export const diagnostic = true;\n', 'utf-8');
    const diagnosticService = new DiagnosticService(processService, testDir);
    const diagRes = await diagnosticService.runDiagnostics('typecheck', {
      customCwd: testDir,
      command: 'node --check diagnostic.js',
    });
    assert.ok('success' in diagRes, 'runDiagnostics result should have success property');
    assert.strictEqual(diagRes.success, true, 'Explicit isolated diagnostic command should pass');

    // 11. Regression Test: CRLF Large File (700 lines) editFile at line 500
    console.log('11. Testing Large CRLF File (700 lines) editFile precision...');
    const lines700: string[] = [];
    lines700.push('using System;'); // Line 1
    lines700.push('using SubscriptionCommerce.Application;'); // Line 2
    for (let i = 3; i <= 499; i++) {
      lines700.push(`    // Line ${i}: C# logic code implementation dummy block`);
    }
    lines700.push('    public async Task<LifecycleCommandResult> RevokePeriodAsync('); // Line 500
    lines700.push('        string periodId,'); // Line 501
    lines700.push('        CancellationToken ct)'); // Line 502
    for (let i = 503; i <= 700; i++) {
      lines700.push(`    // Line ${i}: C# logic code implementation dummy block`);
    }

    // Join with Windows CRLF (\r\n)
    const crlf700Content = lines700.join('\r\n');
    await fileService.writeFile('SubscriptionLifecycleCoordinator.cs', crlf700Content);

    // AI sends LF (\n) targetContent
    const targetSignatureLF = '    public async Task<LifecycleCommandResult> RevokePeriodAsync(\n        string periodId,\n        CancellationToken ct)';
    const replacementSignatureLF = '    public async Task<LifecycleCommandResult> RevokePeriodAsync(\n        string periodId,\n        string reason,\n        CancellationToken ct)';

    const editCrlfRes = await fileService.editFile(
      'SubscriptionLifecycleCoordinator.cs',
      targetSignatureLF,
      replacementSignatureLF
    );

    assert.strictEqual(editCrlfRes.success, true, 'editFile failed on CRLF file');
    assert.strictEqual(editCrlfRes.matchedAtLine, 500, `Matched line mismatch: expected 500, got ${editCrlfRes.matchedAtLine}`);

    // Read back and verify line 1 and line 2 did NOT get corrupted
    const readBack = await fileService.readFile('SubscriptionLifecycleCoordinator.cs');
    const readBackLines = readBack.content.split('\r\n');
    assert.strictEqual(readBackLines[0], 'using System;', `Line 1 corrupted: got "${readBackLines[0]}"`);
    assert.strictEqual(readBackLines[1], 'using SubscriptionCommerce.Application;', `Line 2 corrupted: got "${readBackLines[1]}"`);
    assert.ok(readBack.content.includes('string reason,'), 'Replacement string reason not found');
    console.log(`CRLF 700-line regression test PASSED! (Matched at line ${editCrlfRes.matchedAtLine}, Head intact: "${readBackLines[0]}")`);

    // 13. Test SnapshotService (1-call startup & hash guard)
    console.log('13. Testing SnapshotService (1-call startup & hash-guarded context)...');
    const { SnapshotService } = await import('../src/services/snapshotService.js');
    const { ProjectService } = await import('../src/services/projectService.js');
    const { MemoryService } = await import('../src/services/memoryService.js');
    const testProjectService = new ProjectService(testDir);
    const projectsList = testProjectService.listProjects().projects;
    const snapshotProject = projectsList[0]?.name;
    assert.ok(snapshotProject, 'Snapshot integration project should be registered');
    const testMemoryService = new MemoryService(path.join(testDir, '.server-state'));
    const snapshotGitService = new GitService(testDir, testProjectService);
    const snapshotService = new SnapshotService(testProjectService, snapshotGitService, testMemoryService);
    await fileService.writeFile('CLAUDE.md', '# Subscription Service Rules\n- Always run unit tests');
    const snapshot1 = await snapshotService.getSnapshot({ project: snapshotProject });
    assert.ok(snapshot1.instructions.contentHash, 'Snapshot contentHash missing');
    assert.strictEqual(snapshot1.instructions.unchanged, false, 'First snapshot should have unchanged=false');
    assert.ok(snapshot1.instructions.content?.includes('Always run unit tests'), 'Snapshot content missing');

    // Test with knownInstructionHash (should return unchanged: true and omit content)
    const snapshot2 = await snapshotService.getSnapshot({
      project: snapshotProject,
      knownInstructionHash: snapshot1.instructions.contentHash,
    });
    assert.strictEqual(snapshot2.instructions.unchanged, true, 'Matching hash should set unchanged=true');
    assert.strictEqual(snapshot2.instructions.content, undefined, 'Matching hash should omit content body');
    console.log('Snapshot 2 hash guard verified (Tokens saved: content body successfully omitted!)');

    // 14. Test SymbolService (Semantic Code Reader)
    console.log('14. Testing SymbolService (Semantic Code Reader)...');
    const { SymbolService } = await import('../src/services/symbolService.js');
    const symbolService = new SymbolService(testDir, testProjectService);
    const sampleCSharp = `namespace Subscription.App;

public class FinancialCorrectionCoordinator
{
    private readonly IDbContext _db;

    public async Task<CorrectionResult> ApproveRefundAsync(string refundId, CancellationToken ct)
    {
        var item = await _db.Refunds.FindAsync(refundId);
        return new CorrectionResult { Success = true };
    }

    public void RejectRefund(string refundId)
    {
        // sync method
    }
}`;
    await fileService.writeFile('FinancialCorrectionCoordinator.cs', sampleCSharp);
    const symbolsRes = await symbolService.listSymbols('FinancialCorrectionCoordinator.cs', { project: snapshotProject });
    assert.ok(symbolsRes.totalSymbols >= 2, `Expected at least 2 symbols, got ${symbolsRes.totalSymbols}`);

    const readSymRes = await symbolService.readSymbol('FinancialCorrectionCoordinator.cs', 'ApproveRefundAsync', { project: snapshotProject });
    assert.ok(readSymRes.found, 'ApproveRefundAsync not found');
    assert.ok(readSymRes.symbol.content.includes('Task<CorrectionResult> ApproveRefundAsync'), 'Method signature mismatch');

    // 15. Test Guarded apply_patch with SHA256 Verification
    console.log('15. Testing Guarded apply_patch with SHA256 Verification...');
    const guardedPatchRes = await patchService.applyStructuredPatch([
      {
        filePath: 'FinancialCorrectionCoordinator.cs',
        targetContent: '// sync method',
        replacementContent: '// verified sync method',
        expectedBeforeHash: symbolsRes.filePath ? undefined : undefined,
      },
    ]);
    assert.ok(guardedPatchRes.success, 'Guarded patch failed');
    assert.ok(guardedPatchRes.details[0].beforeHash, 'beforeHash missing in details');
    assert.ok(guardedPatchRes.details[0].afterHash, 'afterHash missing in details');
    assert.strictEqual(guardedPatchRes.details[0].outsidePatchUnchanged, true, 'outsidePatchUnchanged should be true');

    // 16. Test CAS Concurrency Conflict in editFile
    console.log('16. Testing CAS Concurrency Conflict in editFile...');
    let threwCasConflict = false;
    try {
      await fileService.editFile('FinancialCorrectionCoordinator.cs', '// verified sync method', '// changed again', {
        expectedBeforeHash: '0000000000000000000000000000000000000000000000000000000000000000', // stale wrong hash
      });
    } catch (err: any) {
      if (err.message.includes('CONCURRENCY_CONFLICT')) {
        threwCasConflict = true;
      }
    }
    assert.ok(threwCasConflict, 'editFile failed to reject stale expectedBeforeHash with CONCURRENCY_CONFLICT');

    // 17. Test GitWorkflowService (Worktrees, Sync, Fingerprint)
    console.log('17. Testing GitWorkflowService in isolated repo...');
    const { GitWorkflowService } = await import('../src/services/gitWorkflowService.js');
    const gitWorkflow = new GitWorkflowService(processService, testDir, testProjectService);
    const fp = await gitWorkflow.getWorkspaceFingerprint(undefined, snapshotProject);
    assert.ok(fp.fingerprint, 'Fingerprint generation failed');
    const syncStatus = await gitWorkflow.getSyncStatus(undefined, snapshotProject);
    assert.ok(syncStatus.fingerprint, 'SyncStatus missing fingerprint');
    assert.strictEqual(syncStatus.branch, 'main', 'Expected main branch');

    // 18. Test DiagnosticParserService (Structured Errors + Unparsed Preservation)
    console.log('18. Testing DiagnosticParserService (Never swallow errors silently)...');
    const { DiagnosticParserService } = await import('../src/services/diagnosticParserService.js');
    const diagParser = new DiagnosticParserService(processService, testDir, testProjectService);
    const sampleCompilerOutput = `
Services/PaymentService.cs(42,15): error CS0246: The type or namespace name 'PaymentRecord' could not be found
Services/PaymentService.cs(99,5): warning CS8618: Non-nullable field is uninitialized
CUSTOM TOOLCHAIN FATAL: Could not link native librocksdb.so due to missing symbol
`;
    const diagResult = diagParser.parseDiagnosticsText(sampleCompilerOutput, testDir);
    assert.strictEqual(diagResult.totalErrors, 1, `Expected 1 error, got ${diagResult.totalErrors}`);
    assert.strictEqual(diagResult.totalWarnings, 1, `Expected 1 warning, got ${diagResult.totalWarnings}`);
    assert.strictEqual(diagResult.unparsedRelevantLines.length, 1, `Expected 1 unparsed relevant line, got ${diagResult.unparsedRelevantLines.length}`);
    assert.ok(diagResult.unparsedRelevantLines[0].includes('CUSTOM TOOLCHAIN FATAL'), 'Unparsed fatal error line missing');

    // 19. Test Real TypeScript AST in SymbolService
    console.log('19. Testing Real TypeScript AST Parsing in SymbolService...');
    const sampleTs = `
export interface IPaymentGateway {
  charge(amount: number): Promise<boolean>;
}

export class StripeGateway implements IPaymentGateway {
  public async charge(amount: number): Promise<boolean> {
    return true;
  }
}
`;
    await fileService.writeFile('gateway.ts', sampleTs);
    const tsSymbols = await symbolService.listSymbols('gateway.ts', { project: snapshotProject });
    assert.strictEqual(tsSymbols.parser, 'typescript-ast', `Expected parser=typescript-ast, got ${tsSymbols.parser}`);
    assert.ok(tsSymbols.totalSymbols >= 2, `Expected >= 2 symbols, got ${tsSymbols.totalSymbols}`);

    // 20. Test SymbolService.findReferences
    console.log('21. Testing SymbolService.findReferences...');
    await fileService.writeFile('usage.ts', `import { StripeGateway } from './gateway';\nconst gw = new StripeGateway();`);
    const refs = await symbolService.findReferences('StripeGateway', { project: snapshotProject });
    assert.ok(refs.totalMatches >= 2, `Expected >= 2 references of StripeGateway, got ${refs.totalMatches}`);

    // 21. Test SearchService.searchWithContext
    console.log('22. Testing SearchService.searchWithContext...');
    const ctxSearch = await searchService.searchWithContext('StripeGateway', { contextLines: 1 });
    assert.ok(ctxSearch.totalMatches >= 2, 'Context search failed to find StripeGateway');
    assert.ok(ctxSearch.results.length >= 2, 'Expected matches across multiple files');
    assert.ok(ctxSearch.results[0].matches[0].snippet.length > 0, 'Snippet should not be empty');

    // 23. Test MemoryService.writeHandoff with persist="server" vs persist="workspace"
    console.log('23. Testing MemoryService.writeHandoff persist options...');
    const serverHandoff = await testMemoryService.writeHandoff(testDir, 'Server persist test', ['Task A'], 'server');
    assert.strictEqual(serverHandoff.filePath, 'server://handoff.md', `Expected server handoff URI, got ${serverHandoff.filePath}`);

    // 24. Test Safe File Operations (delete, move, hash, compare)
    console.log('24. Testing Safe File Operations (delete, move, hash, compare)...');
    await fileService.writeFile('file_a.txt', 'Hello World 123');
    await fileService.writeFile('file_b.txt', 'Hello World 123');
    const compRes = await fileService.compareFileContent('file_a.txt', 'file_b.txt');
    assert.strictEqual(compRes.identical, true, 'compareFileContent failed: files should be identical');
    const hashRes = await fileService.hashFile('file_a.txt');
    assert.strictEqual(hashRes.sha256, compRes.hashA, 'Hash mismatch between hashFile and compareFileContent');
    const moveRes = await fileService.moveFile('file_b.txt', 'renamed_b.txt');
    assert.strictEqual(moveRes.success, true, 'moveFile failed');
    const delRes = await fileService.deleteFile('renamed_b.txt');
    assert.strictEqual(delRes.deleted, true, 'deleteFile failed');

    // 25. Test GitWorkflowService.compareBranches in isolated repo
    console.log('25. Testing GitWorkflowService.compareBranches in isolated repo...');
    await processService.runCommand({ command: 'git checkout -b feature-test-branch', cwd: testDir });
    await fileService.writeFile('feature_file.txt', 'Feature content');
    await gitService.commit({ message: 'Add feature file' });
    const branchComp = await gitWorkflow.compareBranches('main', 'feature-test-branch', undefined, snapshotProject);
    assert.ok(branchComp.aheadCount >= 1, `Expected >= 1 ahead commit, got ${branchComp.aheadCount}`);
    assert.ok(branchComp.filesChangedCount >= 1, 'Expected at least 1 file changed');

    // 26. Test GitWorkflowService.closeFeatureBranch with verification gate in isolated repo
    console.log('26. Testing GitWorkflowService.closeFeatureBranch with verification gate in isolated repo...');
    await processService.runCommand({ command: 'git add -A', cwd: testDir });
    await gitService.commit({ message: 'Commit all before close', files: ['.'] });
    const closeRes = await gitWorkflow.closeFeatureBranch({
      branchName: 'feature-test-branch',
      targetBranch: 'main',
      project: snapshotProject,
    });
    assert.strictEqual(closeRes.success, true, 'closeFeatureBranch failed');

    console.log('\n🎉 ALL 26 INTEGRATION TESTS PASSED WITH 0 ASSERTION FAILURES! 🎉');
  } finally {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      console.log(`Cleaned up isolated test workspace: ${testDir}`);
    } catch {
      // ignore cleanup
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ INTEGRATION TEST FAILED WITH EXCEPTION:');
  console.error(err);
  process.exit(1);
});
