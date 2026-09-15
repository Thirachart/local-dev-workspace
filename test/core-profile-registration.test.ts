import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORE_TOOL_NAMES, getProfileToolNames } from '../src/transports/openapi.js';
import { registerTools } from '../src/tools/index.js';

describe('WinSpace Core Profile Tool Registration', () => {
  it('has exact 18 tools in Core Profile definition', () => {
    assert.equal(CORE_TOOL_NAMES.length, 18);
    const expected = [
      'open_project',
      'get_project_snapshot',
      'search_context',
      'read_symbol',
      'read_file',
      'write_file',
      'apply_patch',
      'project_diagnostics',
      'run_command',
      'git_status',
      'git_commit',
      'git_branch',
      'git_push',
      'verify_changes',
      'commit_and_push',
      'workspace_health',
      'list_skills',
      'read_skill',
    ];
    assert.deepEqual([...CORE_TOOL_NAMES].sort(), [...expected].sort());
  });

  it('registers only 18 tools when toolProfile is core', () => {
    const registered = new Map<string, any>();
    const mockServer = {
      tool(name: string, description: string, schema: any, handler: any) {
        registered.set(name, { description, schema, handler });
      },
    };

    const mockServices: any = {
      fileService: { baseDir: process.cwd() },
      searchService: {},
      processService: {},
      gitService: {},
      projectService: { checkPermission: () => ({ allowed: true }) },
      memoryService: {},
    };

    registerTools(mockServer as any, mockServices, { toolProfile: 'core' });

    assert.equal(registered.size, 18);
    assert.deepEqual(
      Array.from(registered.keys()).sort(),
      [...CORE_TOOL_NAMES].sort()
    );
  });

  it('registers all tools when toolProfile is full', () => {
    const registered = new Map<string, any>();
    const mockServer = {
      tool(name: string, description: string, schema: any, handler: any) {
        registered.set(name, { description, schema, handler });
      },
    };

    const mockServices: any = {
      fileService: { baseDir: process.cwd() },
      searchService: {},
      processService: {},
      gitService: {},
      projectService: { checkPermission: () => ({ allowed: true }) },
      memoryService: {},
    };

    registerTools(mockServer as any, mockServices, { toolProfile: 'full' });

    assert.ok(registered.size >= 50, `Expected >= 50 tools, got ${registered.size}`);
  });

  it('honors WINSPACE_TOOL_PROFILE environment variable', () => {
    const oldEnv = process.env.WINSPACE_TOOL_PROFILE;
    try {
      process.env.WINSPACE_TOOL_PROFILE = 'core';
      const registered = new Map<string, any>();
      const mockServer = {
        tool(name: string, description: string, schema: any, handler: any) {
          registered.set(name, { description, schema, handler });
        },
      };

      const mockServices: any = {
        fileService: { baseDir: process.cwd() },
        searchService: {},
        processService: {},
        gitService: {},
        projectService: { checkPermission: () => ({ allowed: true }) },
        memoryService: {},
      };

      registerTools(mockServer as any, mockServices);

      assert.equal(registered.size, 18);
      assert.deepEqual(
        Array.from(registered.keys()).sort(),
        [...CORE_TOOL_NAMES].sort()
      );
    } finally {
      if (oldEnv === undefined) {
        delete process.env.WINSPACE_TOOL_PROFILE;
      } else {
        process.env.WINSPACE_TOOL_PROFILE = oldEnv;
      }
    }
  });
});
