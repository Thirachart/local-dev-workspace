import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TestRunnerService } from '../src/services/testRunnerService.js';
import { WorkspaceHealthService } from '../src/services/workspaceHealthService.js';
import { GitWorkflowService } from '../src/services/gitWorkflowService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { GitService } from '../src/services/gitService.js';
import { DiagnosticService } from '../src/services/diagnosticService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { getOpenApiSpec } from '../src/transports/openapi.js';
import { listPublicToolMetadata } from '../src/tools/registry.js';

describe('Enhanced Core Tools: run_tests, workspace_health, process_manager, git_branch, git_push & OpenAPI Profiles', () => {
  const testDir = path.join(os.tmpdir(), `chat-dev-enhanced-test-${Date.now()}`);
  let projectService: ProjectService;
  let processService: ProcessService;
  let gitService: GitService;
  let gitWorkflowService: GitWorkflowService;
  let diagnosticService: DiagnosticService;
  let memoryService: MemoryService;
  let testRunnerService: TestRunnerService;
  let workspaceHealthService: WorkspaceHealthService;
  let projectName: string;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'mock-project',
        version: '1.0.0',
        scripts: { test: 'node --test' },
      })
    );

    projectService = new ProjectService(testDir);
    projectName = path.basename(testDir);
    processService = new ProcessService(testDir, projectService);
    await processService.runCommand({ command: 'git init -b main', cwd: testDir, projectName: projectName });
    await processService.runCommand({ command: 'git config user.email "test@example.com"', cwd: testDir, projectName: projectName });
    await processService.runCommand({ command: 'git config user.name "Tester"', cwd: testDir, projectName: projectName });
    await processService.runCommand({ command: 'git add . && git commit -m "init"', cwd: testDir, projectName: projectName });
    gitService = new GitService(testDir, projectService);
    gitWorkflowService = new GitWorkflowService(processService, testDir, projectService);
    diagnosticService = new DiagnosticService(processService, testDir, projectService);
    memoryService = new MemoryService(process.cwd());
    testRunnerService = new TestRunnerService(processService, testDir, projectService);
    workspaceHealthService = new WorkspaceHealthService(
      projectService,
      gitService,
      diagnosticService,
      processService,
      memoryService,
      testDir
    );
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. TestRunnerService: detects framework and parses output', () => {
    const detected = testRunnerService.detectFramework(testDir);
    assert.strictEqual(detected.command, 'npm test');

    const sampleTapOutput = `
ok 1 - should add numbers
ok 2 - should subtract numbers
not ok 3 - should multiply numbers
# Error: Expected 6 to equal 5
`;
    const parsed = testRunnerService.parseOutput(sampleTapOutput, 'node:test');
    assert.strictEqual(parsed.passed, 2);
    assert.strictEqual(parsed.failed, 1);
    assert.strictEqual(parsed.failures.length, 1);
    assert.strictEqual(parsed.failures[0].testName, 'should multiply numbers');
  });

  it('detects unittest from an explicit command before project metadata', () => {
    assert.equal(testRunnerService.detectFrameworkFromCommand('python -m unittest discover -s tests').framework, 'unittest');
    assert.equal(testRunnerService.detectFrameworkFromCommand('python3 -m unittest').framework, 'unittest');
    assert.equal(testRunnerService.detectFrameworkFromCommand('py -m unittest discover').framework, 'unittest');
    assert.equal(testRunnerService.detectFrameworkFromCommand('C:\\Python312\\python.exe -m unittest').framework, 'unittest');
    assert.equal(testRunnerService.detectFrameworkFromCommand('"C:\\Program Files\\Python312\\python.exe" -m unittest').framework, 'unittest');
    assert.equal(testRunnerService.detectFrameworkFromCommand('custom-runner --tests').framework, 'custom');
    assert.equal(testRunnerService.detectFrameworkFromCommand('custom-runner -m unittest').framework, 'custom');
  });

  it('parses unittest OK output', () => {
    const parsed = testRunnerService.parseOutput('Ran 5 tests in 0.123s\n\nOK\n', 'unittest');
    assert.deepEqual(parsed, { passed: 5, failed: 0, skipped: 0, countKnown: true, failures: [] });
  });

  it('parses unittest failure and skipped counts', () => {
    const parsed = testRunnerService.parseOutput(
      'Ran 5 tests in 0.123s\n\nFAILED (failures=2, errors=1, skipped=1)\n',
      'unittest'
    );
    assert.equal(parsed.passed, 1);
    assert.equal(parsed.failed, 3);
    assert.equal(parsed.skipped, 1);
  });

  it('parses singular unittest output with whitespace', () => {
    const parsed = testRunnerService.parseOutput('  Ran 1 test in 0.001s\n\n  OK  \n', 'unittest');
    assert.deepEqual(parsed, { passed: 1, failed: 0, skipped: 0, countKnown: true, failures: [] });
  });

  it('uses custom unittest command instead of pytest project metadata', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unittest-project-'));
    try {
      await fs.writeFile(path.join(projectDir, 'pytest.ini'), '[pytest]\n', 'utf8');
      const fakeProcessService = {
        runCommand: async () => ({
          exitCode: 0,
          stdout: 'Ran 5 tests in 0.123s\n\nOK\n',
          stderr: '',
        }),
      } as unknown as ProcessService;
      const result = await new TestRunnerService(fakeProcessService, projectDir).runTests({
        customCommand: 'python -m unittest discover -s tests -v',
      });
      assert.equal(result.framework, 'unittest');
      assert.equal(result.command, 'python -m unittest discover -s tests -v');
      assert.equal(result.passed, 5);
      assert.equal(result.failed, 0);
      assert.equal(result.skipped, 0);
      assert.equal(result.total, 5);
      assert.equal(result.status, 'passed');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('keeps unknown custom commands custom inside pytest projects', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-test-project-'));
    try {
      await fs.writeFile(path.join(projectDir, 'pytest.ini'), '[pytest]\n', 'utf8');
      const fakeProcessService = {
        runCommand: async () => ({ exitCode: 1, stdout: 'custom runner failed', stderr: '' }),
      } as unknown as ProcessService;
      const result = await new TestRunnerService(fakeProcessService, projectDir).runTests({
        customCommand: 'custom-runner --tests',
      });
      assert.equal(result.framework, 'custom');
      assert.equal(result.status, 'error');
      assert.equal(result.total, 0);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('2. WorkspaceHealthService: provides 1-call comprehensive health summary', async () => {
    const health = await workspaceHealthService.getHealth({ customCwd: testDir, project: projectName });
    assert.ok(health.timestamp);
    assert.ok(health.project.name);
    assert.ok(typeof health.overallStatus === 'string');
    assert.ok(health.summary.length > 0);
  });

  it('3. ProcessService.manageProcess: handles lifecycle (list, start, logs, stop)', async () => {
    // List
    const listRes = await processService.manageProcess({ action: 'list', projectName });
    assert.ok(Array.isArray(listRes.processes));

    // Start daemon
    const startRes = await processService.manageProcess({
      action: 'start',
      // Keep the fixture finite so the test remains deterministic even when a
      // restricted Windows sandbox denies taskkill on descendant processes.
      command: 'node -e "setTimeout(() => process.exit(0), 1500);"',
      cwd: testDir,
      projectName,
    });
    assert.strictEqual(startRes.action, 'start');
    assert.ok(startRes.processId);

    // Logs
    const logRes = await processService.manageProcess({
      action: 'logs',
      processId: startRes.processId,
      projectName,
    });
    assert.strictEqual(logRes.action, 'logs');
    assert.ok(Array.isArray(logRes.logs));

    // Stop
    const stopRes = await processService.manageProcess({
      action: 'stop',
      processId: startRes.processId,
      projectName,
    });
    assert.strictEqual(stopRes.action, 'stop');
    assert.strictEqual(stopRes.success, true, stopRes.message);
  });

  it('4. GitWorkflowService: getBranchDetails & pushBranch', async () => {
    const branchDetails = await gitWorkflowService.getBranchDetails(testDir, projectName);
    assert.ok(typeof branchDetails.currentBranch === 'string');
    assert.ok(Array.isArray(branchDetails.branches));

    // pushBranch on repo with no remote should fail or handle remote gracefully
    await assert.rejects(
      async () => gitWorkflowService.pushBranch({ customCwd: testDir, project: projectName }),
      /Git push failed/i
    );
  });

  it('6. TrayService: manages tool execution notifications and idle resets', async () => {
    const { TrayService } = await import('../src/services/trayService.js');
    const trayService = new TrayService(4100);
    assert.doesNotThrow(() => {
      trayService.notifyToolStart('write_file');
      trayService.resetToIdle();
      trayService.stop();
    }, 'TrayService methods should execute safely without crashing');
  });

  it('5. OpenAPI Profiles: core, agent, extension, and full expose the intended operations', () => {
    const host = 'https://mock.ngrok.app';

    // Core Profile (Recommended for ChatGPT)
    const core = getOpenApiSpec(host, 'core');
    const coreOps = Object.keys(core.paths);
    assert.ok(coreOps.length <= 30, 'Core profile must be <= 30 ops');
    assert.ok(core.paths['/api/apply_patch'], 'Core profile must have apply_patch');
    assert.ok(core.paths['/api/workspace_health'], 'Core profile must have workspace_health');
        assert.strictEqual(core.paths['/api/run_tests'], undefined, 'run_tests should not be in Core');
    assert.strictEqual(core.paths['/api/process_manager'], undefined, 'process_manager should not be in Core');
    assert.strictEqual(core.paths['/api/run_diagnostics'], undefined, 'run_diagnostics should not be in Core');
    assert.strictEqual(core.paths['/api/parse_diagnostics'], undefined, 'parse_diagnostics should not be in Core');
    assert.strictEqual(core.paths['/api/suggest_tests'], undefined, 'suggest_tests should not be in Core');
    assert.ok(core.paths['/api/git_branch'], 'Core profile must have git_branch');
    assert.ok(core.paths['/api/git_push'], 'Core profile must have git_push');
    assert.ok(core.paths['/api/list_skills'], 'Core profile must have list_skills');
    assert.ok(core.paths['/api/read_skill'], 'Core profile must have read_skill');
    // Verify the current Core profile contract:
    assert.ok(core.paths['/api/write_file'], 'write_file should be in Core');
    assert.strictEqual(core.paths['/api/edit_file'], undefined, 'edit_file should not be in Core');
    assert.strictEqual(core.paths['/api/codex_run'], undefined, 'codex_run should not be in Core');

    // Agent Profile
    const agent = getOpenApiSpec(host, 'agent');
    const agentOps = Object.keys(agent.paths);
    assert.ok(agentOps.length <= 30, 'Agent profile must be <= 30 ops');
    assert.strictEqual(agent.paths['/api/codex_run'], undefined, 'Agent profile must not contain removed codex_run');
    assert.strictEqual(listPublicToolMetadata().some((tool) => tool.name === 'codex_run'), false);

    // Extension Profile
    const ext = getOpenApiSpec(host, 'extension');
    const extOps = Object.keys(ext.paths);
    assert.ok(extOps.length <= 30, 'Extension profile must be <= 30 ops');
    assert.ok(ext.paths['/api/list_skills'], 'Extension profile must contain list_skills');

    // Full Profile
    const full = getOpenApiSpec(host, 'full');
    const fullOps = Object.keys(full.paths);
    assert.ok(fullOps.length >= coreOps.length, 'Full profile must contain at least the core operations');
    assert.ok(full.paths['/api/write_file'], 'Full profile contains write_file');
    assert.ok(full.paths['/api/edit_file'], 'Full profile contains edit_file');
  });
});
