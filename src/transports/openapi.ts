/**
 * OpenAPI 3.1.0 Specification Generator for ChatGPT Custom GPT Actions & API Clients.
 *
 * NOTE: OpenAI Custom GPT Actions enforce a STRICT limit of maximum 30 operations per schema.
 * We provide profiled schemas:
 * - 'core' (default): 25 operations (strictly <= 30) - All essential coding, workspace, git, search & diagnostics.
 * - 'full': All 31+ operations for MCP/API clients without operation limits.
 */

export type OpenApiProfile = 'core' | 'agent' | 'extension' | 'full' | 'custom';

export interface ToolCatalogItem {
  path: string;
  name: string;
  category: string;
  description: string;
}

export const TOOL_CATEGORIES = [
  'Workspace & Health',
  'File Operations',
  'Search & Code Intel',
  'Git Workflow',
  'Terminal & Process',
  'Diagnostics & Testing',
  'Agent & Extension',
] as const;

/**
 * MCP v2 compatibility gateway contract.
 * Existing OpenAPI clients can invoke the same MCP registry without creating
 * one REST operation per tool.
 */
export const MCP_INVOKE_SCHEMA = {
  type: 'object',
  required: ['tool', 'arguments'],
  properties: {
    tool: { type: 'string', description: 'Registered MCP tool name' },
    sessionId: { type: 'string', description: 'Optional MCP v2 session identity' },
    capabilityToken: { type: 'string', description: 'Optional capability token' },
    expectedSnapshotId: { type: 'string', description: 'Workspace observation token for mutations' },
    arguments: { type: 'object', description: 'Original MCP tool arguments' },
  },
} as const;

export function getToolCatalog() {
  return [
    { path: '/api/workspace_health', name: 'workspace_health', category: 'Workspace & Health', description: 'Fast 1-call comprehensive workspace health & state hub' },
    { path: '/api/get_project_snapshot', name: 'get_project_snapshot', category: 'Workspace & Health', description: 'Comprehensive project snapshot with files, git state, and README' },
    { path: '/api/list_projects', name: 'list_projects', category: 'Workspace & Health', description: 'List all registered projects and workspaces' },
    { path: '/api/create_project', name: 'create_project', category: 'Workspace & Health', description: 'Create a new project directory and register it explicitly' },
            { path: '/api/project_overview', name: 'project_overview', category: 'Workspace & Health', description: 'Quick project overview and summary' },
    { path: '/api/read_file', name: 'read_file', category: 'File Operations', description: 'Read file contents from active project' },
    { path: '/api/write_file', name: 'write_file', category: 'File Operations', description: 'Create or overwrite file in active project' },
    { path: '/api/edit_file', name: 'edit_file', category: 'File Operations', description: 'Search and replace precise code snippet in a file' },
    { path: '/api/apply_patch', name: 'apply_patch', category: 'File Operations', description: 'Apply unified diff patch safely' },
    { path: '/api/list_directory', name: 'list_directory', category: 'File Operations', description: 'List contents of a directory' },
    { path: '/api/get_file_info', name: 'get_file_info', category: 'File Operations', description: 'Get file metadata and size' },
    { path: '/api/grep_search', name: 'grep_search', category: 'Search & Code Intel', description: 'Fast ripgrep text/regex search across codebase' },
    { path: '/api/find_by_name', name: 'find_by_name', category: 'Search & Code Intel', description: 'Fast glob filename search' },
    { path: '/api/symbol_index', name: 'symbol_index', category: 'Search & Code Intel', description: 'Index and search code symbols (classes, functions, types)' },
    { path: '/api/git_status', name: 'git_status', category: 'Git Workflow', description: 'Get git status (modified, staged, untracked)' },
    { path: '/api/git_diff', name: 'git_diff', category: 'Git Workflow', description: 'Get git diff against HEAD or staged' },
    { path: '/api/git_log', name: 'git_log', category: 'Git Workflow', description: 'View recent git commit history' },
    { path: '/api/git_commit', name: 'git_commit', category: 'Git Workflow', description: 'Stage files and commit to git' },
    { path: '/api/git_branch', name: 'git_branch', category: 'Git Workflow', description: 'Inspect or manage git branches' },
    { path: '/api/git_push', name: 'git_push', category: 'Git Workflow', description: 'Push committed changes to remote repository' },
    { path: '/api/run_command', name: 'run_command', category: 'Terminal & Process', description: 'Execute shell command inside project directory' },

    { path: '/api/list_skills', name: 'list_skills', category: 'Agent & Extension', description: 'Discover agent skills installed in project or global configuration' },
    { path: '/api/read_skill', name: 'read_skill', category: 'Agent & Extension', description: 'Read instructions and script contents of a specific skill' },
    { path: '/api/write_handoff', name: 'write_handoff', category: 'Agent & Extension', description: 'Write session handoff notes for long-running workflows' },
    { path: '/api/mcp_invoke', name: 'mcp_invoke', category: 'Workspace & Health', description: 'Generic MCP v2 tool invocation gateway' },
  ];
}

export function getOpenApiSpec(hostUrl: string, profile: OpenApiProfile = 'core', customKeys?: string[]) {
  const allPaths: Record<string, any> = {
    '/api/workspace_health': {
      post: {
        summary: 'Fast 1-call comprehensive workspace health & state hub',
        description:
          'CRITICAL FIRST-CALL TOOL: Returns git status, compiler/linter diagnostics, active background servers, and project permissions in a single roundtrip to minimize latency and token usage.',
        operationId: 'workspaceHealth',
        'x-openai-isConsequential': false,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  cwd: { type: 'string', description: 'Optional custom directory' },
                  project: { type: 'string', description: 'Target project name' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Workspace health report' } },
      },
    },
    '/api/mcp_invoke': {
      post: {
        summary: 'Invoke any registered MCP v2 tool through compatibility gateway',
        description: 'Generic OpenAPI compatibility endpoint. Delegates execution to the MCP tool registry while preserving session, capability, snapshot and transaction rules.',
        operationId: 'mcpInvoke',
        'x-openai-isConsequential': true,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: MCP_INVOKE_SCHEMA,
            },
          },
        },
        responses: { '200': { description: 'MCP tool response' } },
      },
    },
    '/api/list_projects': {
      post: {
        summary: 'List all registered projects and workspaces',
        description:
          'CRITICAL: Always call this tool when the user asks how many projects exist, what projects are available, or wants to see the registered workspaces/projects. Returns the active project and all registered projects with their paths and permissions.',
        operationId: 'listProjects',
        'x-openai-isConsequential': false,
        responses: { '200': { description: 'List of projects' } },
      },
    },
    '/api/create_project': {
      post: {
        summary: 'Create and register a new project directory',
        description: 'Explicitly create a new directory and register it as a project. Fails if the target path already exists.',
        operationId: 'createProject',
        'x-openai-isConsequential': true,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'path'],
                properties: {
                  name: { type: 'string' },
                  path: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created project' } },
      },
    },
   '/api/read_file': {
      post: {
        summary: 'Read file contents',
        description: 'Read the contents of a file with optional start_line and end_line pagination',
        operationId: 'readFile',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['path'],
                properties: {
                  path: { type: 'string', description: 'Relative file path from workspace root' },
                  start_line: { type: 'integer', description: 'Optional 1-based start line' },
                  end_line: { type: 'integer', description: 'Optional 1-based end line' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'File content' } },
      },
    },
    '/api/write_file': {
      post: {
        summary: 'Write or overwrite a complete file',
        description: 'Write complete content to a file. Use this for new files or complete rewrites.',
        operationId: 'writeFile',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['path', 'content'],
                properties: {
                  path: { type: 'string', description: 'Relative file path from workspace root' },
                  content: { type: 'string', description: 'Complete content to write' },
                  expected_sha256: { type: 'string', description: 'CAS check hash' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Write result' } },
      },
    },
    '/api/edit_file': {
      post: {
        summary: 'Targeted search and replace in a file',
        description: 'Find and replace exact text blocks in a file with zero hallucination.',
        operationId: 'editFile',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['path', 'old_text', 'new_text'],
                properties: {
                  path: { type: 'string', description: 'Relative file path from workspace root' },
                  old_text: { type: 'string', description: 'Exact existing code snippet to match' },
                  new_text: { type: 'string', description: 'Replacement code' },
                  expected_sha256: { type: 'string', description: 'CAS check hash' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Edit result' } },
      },
    },
    '/api/apply_patch': {
      post: {
        summary: 'Apply high-integrity multi-file patch with line range targeting',
        description: 'Apply unified diffs or targeted line replacements across one or multiple files with per-file atomicity.',
        operationId: 'applyPatch',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  patch: { type: 'string', description: 'Unified diff text format (alias for diff)' },
                  diff: { type: 'string', description: 'Standard Unified Diff string format (alias for patch)' },
                  files: {
                    type: 'array',
                    description: 'Structured list of files and replace operations (alias for chunks)',
                    items: {
                      type: 'object',
                      properties: {
                        path: { type: 'string' },
                        filePath: { type: 'string' },
                        targetContent: { type: 'string' },
                        replacementContent: { type: 'string' },
                        expectedSha256: { type: 'string' },
                        operations: { type: 'array', items: { type: 'object' } },
                      },
                    },
                  },
                  chunks: {
                    type: 'array',
                    description: 'List of structured patch chunks across one or multiple files (alias for files)',
                    items: {
                      type: 'object',
                      properties: {
                        filePath: { type: 'string' },
                        path: { type: 'string' },
                        targetContent: { type: 'string' },
                        replacementContent: { type: 'string' },
                        allowMultiple: { type: 'boolean' },
                      },
                    },
                  },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Patch application result' } },
      },
    },
    '/api/list_directory': {
      post: {
        summary: 'List contents of a directory',
        description: 'List subdirectories and files in a path with optional recursive exploration and max_depth.',
        operationId: 'listDirectory',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Directory path relative to workspace root (default: ".")' },
                  recursive: { type: 'boolean', description: 'Whether to list recursively' },
                  max_depth: { type: 'integer', description: 'Max directory depth for recursion' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Directory contents' } },
      },
    },
    '/api/run_command': {
      post: {
        summary: 'Execute a terminal shell command',
        description: 'Run build tools, tests, package managers, and scripts in the workspace with real-time output.',
        operationId: 'runCommand',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['command'],
                properties: {
                  command: { type: 'string', description: 'Shell command to execute' },
                  cwd: { type: 'string', description: 'Working directory for command' },
                  timeout_ms: { type: 'integer', description: 'Timeout in ms (default: 60000)' },
                  project: { type: 'string', description: 'Optional project name or path' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Command execution result' } },
      },
    },
    '/api/search_files': {
      post: {
        summary: 'Grep search text/regex across codebase',
        description: 'Search for text, function definitions, or regex patterns across workspace files with smart exclusions.',
        operationId: 'searchFiles',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', description: 'Search term or regex pattern' },
                  is_regex: { type: 'boolean', description: 'Whether query is regular expression' },
                  case_sensitive: { type: 'boolean', description: 'Case sensitivity' },
                  file_pattern: { type: 'string', description: 'Glob filter for filenames (e.g. "*.ts")' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Search results' } },
      },
    },
    '/api/find_files': {
      post: {
        summary: 'Find files by glob pattern',
        description: 'Locate files matching name patterns (e.g. "**/*.controller.ts", "package.json").',
        operationId: 'findFiles',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['pattern'],
                properties: {
                  pattern: { type: 'string', description: 'Glob pattern to search for' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Matching files list' } },
      },
    },
    '/api/git_status': {
      post: {
        summary: 'Get Git working tree status',
        description: 'Check modified, staged, untracked, and deleted files in the repository.',
        operationId: 'gitStatus',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Git status report' } },
      },
    },
    '/api/git_diff': {
      post: {
        summary: 'Get Git diff of working tree changes',
        description: 'Inspect exact line-by-line diffs for unstaged or staged changes.',
        operationId: 'gitDiff',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Optional specific file path' },
                  staged: { type: 'boolean', description: 'Whether to show staged diff' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Git diff' } },
      },
    },
    '/api/git_log': {
      post: {
        summary: 'Get Git commit history',
        description: 'Retrieve recent git commits with hash, author, date, and message.',
        operationId: 'gitLog',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  max_count: { type: 'integer', description: 'Number of commits to return (default: 10)' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Commit logs' } },
      },
    },
    '/api/git_commit': {
      post: {
        summary: 'Commit staged or all changes to Git',
        description: 'Create a guarded Git commit with message and optional auto-staging.',
        operationId: 'gitCommit',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', description: 'Commit message' },
                  stage_all: { type: 'boolean', description: 'Stage all modified files before commit' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Commit result' } },
      },
    },
    '/api/git_branch': {
      post: {
        summary: 'List branches and view git tracking status',
        description:
          'List all local and remote branches, active branch name, upstream remote tracking status, and ahead/behind commit counts.',
        operationId: 'gitBranch',
        'x-openai-isConsequential': false,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  cwd: { type: 'string', description: 'Optional repository working directory' },
                  project: { type: 'string', description: 'Target project name' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Git branch details' } },
      },
    },
    '/api/git_push': {
      post: {
        summary: 'Push committed changes to remote git repository',
        description:
          'Push local commits to remote repository with upstream branch tracking, safety checks, and rejection handling.',
        operationId: 'gitPush',
        'x-openai-isConsequential': true,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  branch: { type: 'string', description: 'Target branch to push (defaults to active branch)' },
                  remote: { type: 'string', description: 'Remote repository name (default: origin)' },
                  setUpstream: { type: 'boolean', description: 'Set upstream tracking branch (-u)' },
                  force: { type: 'boolean', description: 'Force push with lease' },
                  dryRun: { type: 'boolean', description: 'Simulate push without sending data' },
                  cwd: { type: 'string', description: 'Optional repository working directory' },
                  project: { type: 'string', description: 'Target project name' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Git push result' } },
      },
    },
    '/api/project_diagnostics': {
      post: {
        summary: 'Run project compiler & linter diagnostics',
        description: 'Execute an explicit project diagnostic command, or use project-declared scripts; never guess a global toolchain when no command is configured.',
        operationId: 'projectDiagnostics',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  command: { type: 'string', description: 'Explicit diagnostic command; recommended when the project does not declare a script' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Diagnostics result' } },
      },
    },
    '/api/run_tests': {
      post: {
        summary: 'Run project test suite across all languages with structured output',
        description:
          'Execute automated tests for Node.js/TypeScript, Python, Go, Rust, Java, or custom command. Returns structured passed/failed counts, duration, and failure diagnostics without messy ANSI output.',
        operationId: 'runTests',
        'x-openai-isConsequential': false,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  customCommand: { type: 'string', description: 'Custom test command (e.g. npm test, pytest -k test_auth, cargo test)' },
                  testFilter: { type: 'string', description: 'Optional filter or test pattern' },
                  cwd: { type: 'string', description: 'Working directory for test execution' },
                  project: { type: 'string', description: 'Target project name' },
                  timeoutMs: { type: 'number', description: 'Max timeout in milliseconds (default: 60000)' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Structured test results' } },
      },
    },
    '/api/process_manager': {
      post: {
        summary: 'Structured background process & dev server lifecycle manager',
        description:
          'Manage background servers, watchers, and daemons: start, stop, restart, view recent logs, or list active background processes.',
        operationId: 'processManager',
        'x-openai-isConsequential': true,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action'],
                properties: {
                  action: { type: 'string', enum: ['start', 'stop', 'restart', 'logs', 'list'], description: 'Action to perform' },
                  command: { type: 'string', description: 'Command to run for start or restart (e.g. npm run dev)' },
                  processId: { type: 'string', description: 'Process/Task ID to stop, restart, or inspect logs' },
                  cwd: { type: 'string', description: 'Working directory' },
                  lines: { type: 'number', description: 'Number of log lines to tail (default: 50)' },
                  project: { type: 'string', description: 'Target project name' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Process management response' } },
      },
    },
    '/api/list_symbols': {
      post: {
        summary: 'List classes, methods, and functions in a source file',
        description: 'Extract structured symbols (classes, interfaces, methods, functions) from C#, TypeScript, Vue, or Python files.',
        operationId: 'listSymbols',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['file_path'],
                properties: {
                  file_path: { type: 'string', description: 'Path to source code file' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Extracted symbols list' } },
      },
    },
    '/api/read_symbol': {
      post: {
        summary: 'Read implementation of a specific class or method',
        description: 'Read the exact source code of a specific symbol/method without loading hundreds of lines of unrelated code.',
        operationId: 'readSymbol',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['file_path', 'symbol_name'],
                properties: {
                  file_path: { type: 'string', description: 'Path to source file' },
                  symbol_name: { type: 'string', description: 'Name of the class or method to extract' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Extracted symbol implementation code' } },
      },
    },
    '/api/read_project_instructions': {
      post: {
        summary: 'Read project rules and guidelines (AGENTS.md / CLAUDE.md)',
        description: 'Fetch effective instructions, architectural constraints, and project coding rules.',
        operationId: 'readProjectInstructions',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Project instructions content' } },
      },
    },
    '/api/read_handoff': {
      post: {
        summary: 'Read cross-session handoff notes',
        description: 'Read previous session progress, pending tasks, and next steps from server handoff storage with legacy workspace handoff compatibility.',
        operationId: 'readHandoff',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Optional custom relative file path for handoff' },
                  file_path: { type: 'string', description: 'Alias for path' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Handoff notes' } },
      },
    },
    '/api/write_handoff': {
      post: {
        summary: 'Save cross-session handoff notes',
        description: 'Record work accomplished and next actionable items for subsequent chat sessions.',
        operationId: 'writeHandoff',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Optional custom relative file path for handoff (e.g. HANDOFF.md or .chat-dev/handoff.md)' },
                  file_path: { type: 'string', description: 'Alias for path' },
                  content: { type: 'string', description: 'Raw Markdown content string to write directly to handoff file' },
                  markdown: { type: 'string', description: 'Alias for content' },
                  summary: { type: 'string', description: 'Summary of what was accomplished' },
                  next_steps: { type: 'array', items: { type: 'string' }, description: 'List of pending TODO items' },
                  persist: { type: 'string', enum: ['server', 'workspace'], description: 'Storage mode: server stores outside the project working tree; workspace stores HANDOFF.md in the project.' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Write handoff result' } },
      },
    },
    '/api/list_skills': {
      post: {
        summary: 'List available workflow skills in project or global library',
        description: 'Discover reusable engineering workflows and skills.',
        operationId: 'listSkills',
        'x-openai-isConsequential': false,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'List of skills' } },
      },
    },
    '/api/read_skill': {
      post: {
        summary: 'Read a specific skill instruction guide',
        description: 'Fetch detailed execution instructions for a specific skill.',
        operationId: 'readSkill',
        'x-openai-isConsequential': false,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Name of the skill' },
                  project: { type: 'string', description: 'Optional project name or path' },
                  cwd: { type: 'string', description: 'Custom working directory' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Skill instruction content' } },
      },
    },
    '/api/get_system_prompt': {
      post: {
        summary: 'Get global system prompt and capabilities',
        description: 'Fetch the runtime system prompt for connected AI agents.',
        operationId: 'getSystemPrompt',
        'x-openai-isConsequential': false,
        responses: { '200': { description: 'System prompt content' } },
      },
    },
  };

  // ChatGPT Actions can import a response that only has a description, but
  // the editor warns that an output schema is recommended. All REST handlers
  // in this gateway return JSON objects, so declare that contract once rather
  // than pretending each dynamic tool has a narrower shape than it actually
  // guarantees.
  const defaultOutputSchema = {
    type: 'object',
    additionalProperties: true,
    description: 'JSON object returned by the operation',
  };
  for (const pathItem of Object.values(allPaths)) {
    for (const operation of Object.values(pathItem as Record<string, any>)) {
      const response = (operation as any).responses?.['200'];
      if (response && !response.content) {
        response.content = {
          'application/json': {
            schema: defaultOutputSchema,
          },
        };
      }
    }
  }

  const coreKeys = [
    '/api/workspace_health',
    '/api/list_projects',
    '/api/get_project_snapshot',
    '/api/read_project_instructions',
    '/api/read_handoff',
    '/api/write_handoff',
    '/api/read_file',
    '/api/write_file',
    '/api/apply_patch',
    '/api/list_directory',
    '/api/search_files',
    '/api/find_files',
    '/api/list_symbols',
    '/api/read_symbol',
    '/api/project_diagnostics',
    '/api/run_command',
    '/api/git_status',
    '/api/git_diff',
    '/api/git_log',
    '/api/git_commit',
    '/api/git_branch',
    '/api/git_push',
    '/api/list_skills',
    '/api/read_skill',
  ];

  const agentKeys = [...coreKeys];

  const extensionKeys = [
    ...coreKeys,
  ];

  let selectedKeys: string[];
  if (profile === 'custom' && customKeys && customKeys.length > 0) {
    selectedKeys = customKeys;
  } else if (profile === 'full') {
    selectedKeys = Object.keys(allPaths);
  } else if (profile === 'agent') {
    selectedKeys = agentKeys;
  } else if (profile === 'extension') {
    selectedKeys = extensionKeys;
  } else {
    // default 'core'
    selectedKeys = coreKeys;
  }

  const paths: Record<string, any> = {};
  for (const key of selectedKeys) {
    if (allPaths[key]) {
      paths[key] = allPaths[key];
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `Local Dev Tool MCP API (${profile.toUpperCase()} Profile - ${selectedKeys.length} Operations)`,
      description:
        'Local development tools for AI agents: Multi-project management, file editing, terminal commands, code search, git operations. CRITICAL FOR AI AGENTS: If any tool call encounters a temporary connection timeout, network glitch, or tunnel error (e.g. ERR_NGROK_3007), DO NOT stop or ask the user. You MUST AUTOMATICALLY RETRY the tool call up to 3 times silently.',
      version: '2.0.0',
    },
    servers: [{ url: hostUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Secret API Key authentication for Local Dev Tool MCP',
        },
      },
      schemas: {},
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths,
  };
}

/**
 * Actual operation counts per profile, computed from the live path lists
 * (rather than hand-maintained numbers) so callers never drift out of sync
 * as tools are added to/removed from a profile.
 */
export function getProfileOpCounts(): Record<'core' | 'agent' | 'extension' | 'full', number> {
  const profiles: Array<'core' | 'agent' | 'extension' | 'full'> = [
    'core',
    'agent',
    'extension',
    'full',
  ];
  const counts = {} as Record<'core' | 'agent' | 'extension' | 'full', number>;
  for (const profile of profiles) {
    counts[profile] = Object.keys(getOpenApiSpec('http://placeholder', profile).paths).length;
  }
  return counts;
}
