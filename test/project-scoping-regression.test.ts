import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SnapshotManager } from '../src/core/snapshotManager.js';
import { DeliveryScopeResolver } from '../src/context/deliveryScope.js';
import { FileService } from '../src/services/fileService.js';
import { GitService } from '../src/services/gitService.js';
import { GitWorkflowService } from '../src/services/gitWorkflowService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ProcessService } from '../src/services/processService.js';
import { ProjectService } from '../src/services/projectService.js';
import { SearchService } from '../src/services/searchService.js';
import { listPublicToolMetadata } from '../src/tools/registry.js';
import { registerTools } from '../src/tools/index.js';

describe('Explicit project scoping regression', () => {
  let tempDir: string;
  let projectName: string;
  let projectService: ProjectService;
  let processService: ProcessService;
  let registeredTools: Map<string, { schema: Record<string, any>; handler: (args: any, extra?: { sessionId?: string }) => Promise<any> }>;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-project-scope-'));
    projectName = path.basename(tempDir);
    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'project scoped content\n', 'utf8');

    projectService = new ProjectService(tempDir);
    processService = new ProcessService(tempDir, projectService);
    await processService.runCommand({ command: 'git init -b main', projectName });
    await processService.runCommand({ command: 'git config user.email "test@example.com"', projectName });
    await processService.runCommand({ command: 'git config user.name "Project Scope Test"', projectName });
    await processService.runCommand({ command: 'git add .', projectName });
    await processService.runCommand({ command: 'git commit -m "initial"', projectName });

    const fileService = new FileService(tempDir, projectService);
    const searchService = new SearchService(tempDir, projectService);
    const gitService = new GitService(tempDir, projectService);
    const memoryService = new MemoryService(tempDir);
    registeredTools = new Map();

    const server = {
      tool(name: string, _description: string, schema: Record<string, any>, handler: (args: any, extra?: { sessionId?: string }) => Promise<any>) {
        registeredTools.set(name, { schema, handler });
      },
    };

    registerTools(server as any, {
      fileService,
      searchService,
      processService,
      gitService,
      projectService,
      memoryService,
      deliveryScopeResolver: new DeliveryScopeResolver('http', 'project-scope-test'),
    });
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('requires project in every workspace-scoped public tool schema', () => {
    const workspaceToolNames = listPublicToolMetadata()
      .filter((tool) => tool.capability !== 'none')
      .map((tool) => tool.name);

    const violations = workspaceToolNames.filter((name) => {
      const projectSchema = registeredTools.get(name)?.schema.project;
      return !projectSchema || projectSchema.safeParse(undefined).success;
    });

    assert.deepEqual(violations, []);
  });

  it('describes project selectors consistently as registered name or id', () => {
    const workspaceToolNames = listPublicToolMetadata()
      .filter((tool) => tool.capability !== 'none')
      .map((tool) => tool.name);

    const violations = workspaceToolNames.filter((name) => {
      const description = registeredTools.get(name)?.schema.project?.description;
      return description !== 'Required registered project name or id';
    });

    assert.deepEqual(violations, []);
  });

  it('creates a snapshot token without dropping the explicit project', async () => {
    const snapshotManager = new SnapshotManager(processService, tempDir, projectService);

    const observation = await snapshotManager.getObservationToken(undefined, projectName);

    assert.equal(observation.projectId, projectName);
    assert.match(observation.snapshotId, /^snap_[a-f0-9]{16}$/);
  });

  it('propagates project through registered File, Search, Process, and Git tools', async () => {
    const calls = [
      ['read_file', { project: projectName, path: 'sample.txt' }],
      ['find_files', { project: projectName, pattern: '**/*.txt' }],
      ['run_command', { project: projectName, command: 'node -e "process.stdout.write(\'PROJECT_OK\')"' }],
      ['git_status', { project: projectName }],
    ] as const;

    for (const [name, args] of calls) {
      const result = await registeredTools.get(name)!.handler(args);
      assert.notEqual(result.isError, true, `${name} failed: ${result.content?.[0]?.text}`);
    }
  });

  it('propagates project into nested helper commands', async () => {
    const calls = [
      [
        'build_diagnostics',
        { project: projectName, target: 'custom', custom_command: 'node -e "process.exit(0)"' },
      ],
      [
        'run_tests',
        { project: projectName, customCommand: 'node -e "process.stdout.write(\'ok 1 - scoped\')"' },
      ],
    ] as const;

    for (const [name, args] of calls) {
      const result = await registeredTools.get(name)!.handler(args);
      assert.notEqual(result.isError, true, `${name} failed: ${result.content?.[0]?.text}`);
    }
  });

  it('keeps project scope throughout the branch-close workflow', async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-project-branch-'));
    const repoProject = path.basename(repoDir);
    const projects = new ProjectService(repoDir);
    const processes = new ProcessService(repoDir, projects);
    const workflow = new GitWorkflowService(processes, repoDir, projects);

    try {
      await fs.writeFile(path.join(repoDir, 'main.txt'), 'main\n', 'utf8');
      await processes.runCommand({ command: 'git init -b main', projectName: repoProject });
      await processes.runCommand({ command: 'git config user.email "test@example.com"', projectName: repoProject });
      await processes.runCommand({ command: 'git config user.name "Project Scope Test"', projectName: repoProject });
      await processes.runCommand({ command: 'git add .', projectName: repoProject });
      await processes.runCommand({ command: 'git commit -m "main"', projectName: repoProject });
      await processes.runCommand({ command: 'git checkout -b feature/project-scope', projectName: repoProject });
      await fs.writeFile(path.join(repoDir, 'feature.txt'), 'feature\n', 'utf8');
      await processes.runCommand({ command: 'git add .', projectName: repoProject });
      await processes.runCommand({ command: 'git commit -m "feature"', projectName: repoProject });

      const result = await workflow.closeFeatureBranch({
        branchName: 'feature/project-scope',
        targetBranch: 'main',
        project: repoProject,
      });

      assert.equal(result.success, true);
      const branch = await processes.runCommand({ command: 'git branch --show-current', projectName: repoProject });
      assert.equal(branch.stdout.trim(), 'main');
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });
});
