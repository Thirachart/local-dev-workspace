import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FileService } from '../services/fileService.js';
import { SearchService } from '../services/searchService.js';
import { ProcessService } from '../services/processService.js';
import { GitService } from '../services/gitService.js';
import { ProjectService } from '../services/projectService.js';
import { MemoryService } from '../services/memoryService.js';
import { PatchService, serializePatchError } from '../services/patchService.js';
import { DiagnosticService } from '../services/diagnosticService.js';
import { SnapshotService } from '../services/snapshotService.js';
import { SymbolService } from '../services/symbolService.js';
import { GitWorkflowService } from '../services/gitWorkflowService.js';
import { DiagnosticParserService } from '../services/diagnosticParserService.js';
import { TestRunnerService } from '../services/testRunnerService.js';
import { WorkspaceHealthService } from '../services/workspaceHealthService.js';
import { ContextLedger } from '../context/contextLedger.js';
import { DeliveryPlanner } from '../context/deliveryPlanner.js';
import { sha256Content } from '../context/contentFingerprint.js';
import { DeliveryScopeResolver } from '../context/deliveryScope.js';
import { getPublicToolMetadata } from './registry.js';
import { ProjectPermissionGuard } from '../core/permissions.js';
import { SnapshotManager } from '../core/snapshotManager.js';
import { AuditLogger } from '../core/auditLogger.js';
import { Logger } from '../utils/logger.js';

type ToolExtra = { sessionId?: string } | undefined;

export function registerTools(
  server: McpServer,
  services: {
    fileService: FileService;
    searchService: SearchService;
    processService: ProcessService;
    gitService: GitService;
    projectService: ProjectService;
    memoryService: MemoryService;
    patchService?: PatchService;
    diagnosticService?: DiagnosticService;
    snapshotService?: SnapshotService;
    symbolService?: SymbolService;
    gitWorkflowService?: GitWorkflowService;
    diagnosticParserService?: DiagnosticParserService;
    deliveryScopeResolver?: DeliveryScopeResolver;
    contextLedger?: ContextLedger;
    logger?: Logger;
  }
) {
  const {
    fileService,
    searchService,
    processService,
    gitService,
    projectService,
    memoryService,
    patchService = new PatchService(process.cwd(), projectService),
    diagnosticService = new DiagnosticService(processService, process.cwd(), projectService),
    snapshotService = new SnapshotService(projectService, gitService, memoryService),
    symbolService = new SymbolService(process.cwd(), projectService),
    gitWorkflowService = new GitWorkflowService(processService, process.cwd(), projectService),
    diagnosticParserService = new DiagnosticParserService(processService, process.cwd(), projectService),
    deliveryScopeResolver,
    contextLedger = new ContextLedger(),
    logger = new Logger(process.cwd()),
  } = services;

  const testRunnerService = new TestRunnerService(processService, process.cwd(), projectService);
  const workspaceHealthService = new WorkspaceHealthService(
    projectService,
    gitService,
    diagnosticService,
    processService,
    memoryService,
    process.cwd()
  );


  const deliveryPlanner = new DeliveryPlanner(contextLedger);
  const permissionGuard = new ProjectPermissionGuard(projectService);
  const coreSnapshotManager = new SnapshotManager(processService, process.cwd(), projectService);
  const auditLogger = AuditLogger.getInstance();

  const registerTool = ((
    name: string,
    description: string,
    schema: Record<string, any>,
    handler: (args: any, ...rest: any[]) => Promise<any>
  ) => {
    const metadata = getPublicToolMetadata(name);
    const effectiveSchema = metadata.snapshotPolicy === 'none'
      ? schema
      : {
          ...schema,
          expected_snapshot_id: z.string().optional().describe('Optional workspace observation token. Legacy-compatible tools validate it when supplied.'),
        };

    return (server.tool as any)(name, description, effectiveSchema, async (args: any = {}, ...rest: any[]) => {
      const startedAt = Date.now();
      const project = args?.project as string | undefined;
      const cwd = args?.cwd as string | undefined;
      const targetPath = args?.path || args?.targetPath || args?.file_path || args?.source_path;

      try {
        if (metadata.capability !== 'none') {
          permissionGuard.assertAllowed(metadata.capability, targetPath, { project, customCwd: cwd });
        }

        let snapshotBefore: string | undefined;
        if (metadata.snapshotPolicy !== 'none') {
          snapshotBefore = (await coreSnapshotManager.getObservationToken(cwd, project)).snapshotId;
          if (args?.expected_snapshot_id && args.expected_snapshot_id !== snapshotBefore) {
            const err: any = new Error(`[STALE_SNAPSHOT] Expected "${args.expected_snapshot_id}" but found "${snapshotBefore}".`);
            err.category = 'conflict';
            err.code = 'STALE_SNAPSHOT';
            throw err;
          }
        }

        const result = await handler(args, ...rest);
        if (metadata.mutation && !result?.isError) {
          let snapshotAfter: string | undefined;
          if (metadata.snapshotPolicy !== 'none') {
            snapshotAfter = (await coreSnapshotManager.getObservationToken(cwd, project)).snapshotId;
          }
          auditLogger.logMutation({
            operationId: `op_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
            project: project || 'unknown',
            tool: name,
            targetPaths: [targetPath || args?.dest_path || 'workspace'].filter(Boolean),
            beforeHashes: {},
            afterHashes: {},
            snapshotBefore,
            snapshotAfter,
            durationMs: Date.now() - startedAt,
          });
        }
        logger.logAction({
          source: 'mcp',
          action: name,
          params: args,
          status: result?.isError ? 'error' : 'success',
          durationMs: Date.now() - startedAt,
          resultSummary: result?.isError ? undefined : `Completed ${name}`,
          error: result?.isError ? 'Tool returned an error response.' : undefined,
        });
        return result;
      } catch (err: any) {
        logger.logAction({
          source: 'mcp',
          action: name,
          params: args,
          status: 'error',
          durationMs: Date.now() - startedAt,
          error: err.message || String(err),
        });
        return {
          isError: true,
          content: [{ type: 'text', text: `${err.code ? `[${err.code}] ` : ''}${err.message || String(err)}` }],
        };
      }
    });
  }) as typeof server.tool;

  // --- PROJECT MANAGEMENT TOOLS ---

  // 1. list_projects
  registerTool(
    'list_projects',
    'List all registered projects and directories. Operations must specify project explicitly.',
    {
      compact: z.boolean().optional().describe('Return compact project metadata without heavy instructions (default true)'),
      limit: z.number().optional().describe('Maximum number of projects to return for pagination'),
      offset: z.number().optional().describe('Number of projects to skip for pagination'),
    },
    async ({ compact = true, limit, offset }) => {
      try {
        const result = projectService.listProjects('global', compact, { limit, offset, compact });
        const sanitized = {
          projects: result.projects.map(p => projectService.sanitizeProjectForClient(p)),
          totalCount: result.totalCount,
          limit: result.limit,
          offset: result.offset,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(sanitized, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to list projects: ${err.message}` }] };
      }
    }
  );

  // active project tools removed. Project operations are explicit.

  // 4. add_project
  registerTool(
    'add_project',
    'Register a new project and directory path into the workspace registry. Automatically creates the directory if it does not exist.',
    {
      name: z.string().describe('Unique name for the project (e.g. "my-web-app", "backend-api")'),
      path: z.string().describe('Absolute or relative directory path for the project (e.g. "D:/labs/my-web-app")'),
      description: z.string().optional().describe('Short description of the project'),

    },
    async ({ name, path: projectPath, description }) => {
      try {
        const result = await projectService.addProject({ name, path: projectPath, description });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ message: `Project '${result.name}' added successfully`, project: result }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to add project: ${err.message}` }] };
      }
    }
  );

  // 5. remove_project
  registerTool(
    'remove_project',
    'Remove/unregister a project from the workspace registry.',
    {
      name: z.string().describe('The name of the project to remove'),
      delete_files: z.boolean().optional().describe('Whether to delete the project folder from disk completely (default false)'),
    },
    async ({ name, delete_files = false }) => {
      try {
        const result = await projectService.removeProject(name, delete_files);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to remove project: ${err.message}` }] };
      }
    }
  );

  // 1. read_file
  registerTool(
    'read_file',
    'Read the contents of a file. Supports line range pagination (start_line, end_line) to save tokens.',
    {
      project: z.string().describe('Required registered project name or id'),
      path: z.string().describe('Relative or absolute path to the file to read'),
      start_line: z.number().int().positive().optional().describe('1-indexed line number to start reading from'),
      end_line: z.number().int().positive().optional().describe('1-indexed line number to end reading at'),
      known_sha256: z.string().optional().describe('Optional content hash previously received for this exact read range. Enables unchanged/diff delivery.'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, path, start_line, end_line, known_sha256, cwd }, extra?: ToolExtra) => {
      try {
        const projectInfo = projectService.getRequiredProject(project);
        const projectId = projectInfo.id || projectInfo.name;
        const deliveryScope = deliveryScopeResolver?.resolve(extra, projectId) ?? {
          knowledgeScope: 'unknown' as const,
          trackable: false,
        };
        const result = await fileService.readFile(path, {
          startLine: start_line,
          endLine: end_line,
          customCwd: cwd,
          project,
        });

        const key = `${result.resolvedPath}:${result.startLine}-${result.endLine}`;
        const delivery = deliveryPlanner.plan({
          scope: deliveryScope.scopeId,
          projectId,
          knowledgeScope: deliveryScope.knowledgeScope,
          key,
          content: result.content,
          knownSha256: known_sha256,
        });
        const response = {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ...result,
                content: delivery.delivery === 'full' ? delivery.content : undefined,
                delivery: delivery.delivery,
                deliveryId: delivery.deliveryId,
                deliveryFallback: delivery.deliveryFallback,
                sha256: delivery.sha256,
                baseSha256: delivery.baseSha256,
                patch: delivery.patch,
                truncated: delivery.truncated,
              }, null, 2),
            },
          ],
        };

        if (deliveryScope.trackable && deliveryScope.scopeId) {
          deliveryPlanner.commit({
            scope: deliveryScope.scopeId,
            projectId,
            key,
            content: result.content,
            plan: delivery,
          });
        }

        return response;
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read file: ${err.message}` }],
        };
      }
    }
  );

  // 1b. context_delivery_status
  registerTool(
    'context_delivery_status',
    'Report session-scoped delivery history for a file/range without returning source content.',
    {
      project: z.string().describe('Required registered project name or id'),
      path: z.string().describe('Relative or absolute path to the file to read'),
      start_line: z.number().int().positive().optional().describe('1-indexed line number to start reading from'),
      end_line: z.number().int().positive().optional().describe('1-indexed line number to end reading at'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, path, start_line, end_line, cwd }, extra?: ToolExtra) => {
      try {
        const projectInfo = projectService.getRequiredProject(project);
        const projectId = projectInfo.id || projectInfo.name;
        const deliveryScope = deliveryScopeResolver?.resolve(extra, projectId) ?? {
          knowledgeScope: 'unknown' as const,
          trackable: false,
        };
        const result = await fileService.readFile(path, {
          startLine: start_line,
          endLine: end_line,
          customCwd: cwd,
          project,
        });
        const key = `${result.resolvedPath}:${result.startLine}-${result.endLine}`;
        const currentSha256 = sha256Content(result.content);

        if (!deliveryScope.trackable || !deliveryScope.scopeId) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'unknown',
                currentSha256,
                evidence: {
                  serverEmitted: false,
                  hashConfirmed: false,
                  modelConsumed: 'not_observable',
                },
                resendRequired: null,
                recommendedDelivery: 'unknown',
                knowledgeScope: deliveryScope.knowledgeScope,
                reason: 'scope_unavailable',
              }, null, 2),
            }],
          };
        }

        const status = contextLedger.getStatus(deliveryScope.scopeId, key, currentSha256);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: status.status,
              currentSha256: status.currentSha256,
              lastDeliveredSha256: status.lastDeliveredSha256,
              lastDelivery: status.lastDelivery ? {
                deliveryId: status.lastDelivery.deliveryId,
                mode: status.lastDelivery.mode,
                serverEmittedAt: new Date(status.lastDelivery.serverEmittedAt).toISOString(),
              } : undefined,
              evidence: status.evidence,
              resendRequired: status.resendRequired,
              recommendedDelivery: status.recommendedDelivery,
              knowledgeScope: deliveryScope.knowledgeScope,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read delivery status: ${err.message}` }],
        };
      }
    }
  );

  // 2. write_file
  registerTool(
    'write_file',
    'Create a new file or completely overwrite an existing file with the specified content.',
    {
      project: z.string().describe('Required registered project name or id'),
      path: z.string().describe('Relative or absolute path to the file to create or overwrite'),
      content: z.string().describe('The complete file content to write'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, path, content, cwd }) => {
      try {
        const result = await fileService.writeFile(path, content, { customCwd: cwd, project });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to write file: ${err.message}` }],
        };
      }
    }
  );

  // 3. edit_file
  registerTool(
    'edit_file',
    'Perform precise surgical search-and-replace in an existing file. Replaces target_content with replacement_content with CAS integrity checks.',
    {
      project: z.string().describe('Required registered project name or id'),
      path: z.string().describe('Relative or absolute path to the file to edit'),
      target_content: z.string().describe('The exact text chunk to find and replace. Must match characters and whitespace.'),
      replacement_content: z.string().describe('The new replacement text chunk'),
      allow_multiple: z.boolean().optional().describe('Whether to allow replacing multiple occurrences if found (default false)'),
      expected_before_hash: z.string().optional().describe('Optimistic Concurrency Check: Pass the expected SHA256 before-hash. Fails with CONCURRENCY_CONFLICT if file was modified externally.'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, path, target_content, replacement_content, allow_multiple, expected_before_hash, cwd }) => {
      try {
        const result = await fileService.editFile(path, target_content, replacement_content, {
          allowMultiple: allow_multiple,
          expectedBeforeHash: expected_before_hash,
          customCwd: cwd,
          project,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to edit file: ${err.message}` }],
        };
      }
    }
  );

  // 4. list_directory
  registerTool(
    'list_directory',
    'List files and subdirectories within a directory path.',
    {
      project: z.string().describe('Required registered project name or id'),
      path: z.string().optional().describe('Relative or absolute directory path (defaults to current directory)'),
      recursive: z.boolean().optional().describe('Whether to list subdirectories recursively (default false)'),
      max_depth: z.number().int().positive().optional().describe('Maximum depth for recursive listing'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, path = '.', recursive, max_depth, cwd }) => {
      try {
        const result = await fileService.listDirectory(path, {
          recursive,
          maxDepth: max_depth,
          customCwd: cwd,
          project,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list directory: ${err.message}` }],
        };
      }
    }
  );

  // 5. delete_file
  registerTool(
    'delete_file',
    'Delete a file or recursively remove a directory safely without shell quoting errors.',
    {
      path: z.string().describe('Relative or absolute path of the file or folder to delete'),
      force: z.boolean().optional().describe('Do not throw error if file does not exist (default: false)'),
      cwd: z.string().optional().describe('Optional custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ path, force, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('write', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const result = await fileService.deleteFile(path, { force, customCwd: cwd, project });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to delete: ${err.message}` }],
        };
      }
    }
  );

  // 6. find_files
  registerTool(
    'find_files',
    'Find files matching a glob pattern. Automatically ignores node_modules and .git.',
    {
      project: z.string().describe('Required registered project name or id'),
      pattern: z.string().optional().describe('Glob pattern to match files against'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, pattern, cwd }) => {
      try {
        const defaultGlob = ['*', '*'].join('/');
        const targetPattern = pattern || defaultGlob;
        const files = await searchService.findFiles(targetPattern, { customCwd: cwd, project });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ count: files.length, files }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to find files: ${err.message}` }],
        };
      }
    }
  );

  // 7. search_files
  registerTool(
    'search_files',
    'Search for text or regex patterns within codebase files (grep-like search) with line numbers and snippets.',
    {
      query: z.string().describe('Search query string or regex pattern'),
      is_regex: z.boolean().optional().describe('Treat query as regular expression (default false)'),
      case_sensitive: z.boolean().optional().describe('Case-sensitive matching (default false)'),
      file_pattern: z.string().optional().describe('Filter files by glob pattern'),
      max_results: z.number().int().positive().optional().describe('Max search results to return (default 100)'),
      cwd: z.string().optional().describe('Optional custom working directory relative to project root'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ query, is_regex, case_sensitive, file_pattern, max_results, cwd, project }) => {
      try {
        const result = await searchService.searchFiles(query, {
          isRegex: is_regex,
          caseSensitive: case_sensitive,
          filePattern: file_pattern,
          maxResults: max_results,
          customCwd: cwd,
          project,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Search failed: ${err.message}` }],
        };
      }
    }
  );

  // 8. run_command
  registerTool(
    'run_command',
    'Execute a shell command (PowerShell on Windows, Bash on Linux/macOS). Supports timeout and background daemon execution (e.g. dev servers).',
    {
      project: z.string().describe('Required registered project name or id'),
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory to execute command in'),
      timeout_ms: z.number().int().positive().optional().describe('Timeout in milliseconds for synchronous execution (default 60000)'),
      is_daemon: z.boolean().optional().describe('Set to true for long-running processes (dev servers, watchers) to run in the background'),
    },
    async ({ project, command, cwd, timeout_ms, is_daemon }) => {
      try {
        const result = await processService.runCommand({
          command,
          cwd,
          timeoutMs: timeout_ms,
          isDaemon: is_daemon,
          projectName: project,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        const failure = {
          error: err.code || 'COMMAND_EXECUTION_FAILED',
          message: err.message || String(err),
          retryable: Boolean(err.retryable),
        };
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
        };
      }
    }
  );

  // 9. task_status
  registerTool(
    'task_status',
    'Check the status and read recent output logs of a background task started with run_command, including commands promoted after a timeout.',
    {
      project: z.string().describe('Required registered project name or id'),
      task_id: z.string().describe('The Task ID returned from run_command'),
      max_lines: z.number().int().positive().optional().describe('Maximum number of recent output log lines to return (default 100)'),
    },
    async ({ project, task_id, max_lines }) => {
      try {
        const result = processService.getTaskStatus(task_id, max_lines, project);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to check task status: ${err.message}` }],
        };
      }
    }
  );

  // 10. task_list
  registerTool(
    'task_list',
    'List all background tasks and their current running status.',
    {
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ project }) => {
      try {
        const result = processService.listTasks(project);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ count: result.length, tasks: result }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list tasks: ${err.message}` }],
        };
      }
    }
  );

  // 11. task_kill
  registerTool(
    'task_kill',
    'Stop and kill a running background task process.',
    {
      project: z.string().describe('Required registered project name or id'),
      task_id: z.string().describe('The Task ID to stop'),
    },
    async ({ project, task_id }) => {
      try {
        const result = await processService.killTask(task_id, project);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to kill task: ${err.message}` }],
        };
      }
    }
  );

  // 12. git_status
  registerTool(
    'git_status',
    'Get a quick summary of the current Git repository branch and modified/staged/untracked files. isGitRepo means a repository marker was detected; inspect gitAccess and errorCode when Git cannot read it (for example GIT_DUBIOUS_OWNERSHIP).',
    {
      project: z.string().describe('Required registered project name or id'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, cwd }) => {
      try {
        const result = await gitService.getStatus({ customCwd: cwd, project });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Git status failed: ${err.message}` }],
        };
      }
    }
  );

  // 13. git_diff
  registerTool(
    'git_diff',
    'Show git diff for unstaged or staged changes in the workspace.',
    {
      project: z.string().describe('Required registered project name or id'),
      staged: z.boolean().optional().describe('If true, show staged changes (git diff --cached). Default false.'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, staged, cwd }) => {
      try {
        const result = await gitService.getDiff(cwd, staged, project);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Git diff failed: ${err.message}` }],
        };
      }
    }
  );

  // --- PROJECT INSTRUCTIONS & HANDOFF TOOLS ---

  // 14. read_project_instructions
  registerTool(
    'read_project_instructions',
    'Read project guidelines, coding conventions, build/test commands, and architecture rules from AGENTS.md or CLAUDE.md for the specified project.',
    {
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ project }) => {
      try {
        const targetPath = projectService.getRequiredProject(project).path;
        const result = memoryService.findProjectInstructionsSync(targetPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to read project instructions: ${err.message}` }] };
      }
    }
  );

  // 17. read_handoff
  registerTool(
    'read_handoff',
    'Read current session handoff checklist (HANDOFF.md / .chat-dev/handoff.md) for active or specified project to check recent session summary and pending TODOs.',
    {
      path: z.string().optional().describe('Optional custom relative file path to read handoff from'),
      file_path: z.string().optional().describe('Alias for path'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ path, file_path, project }) => {
      try {
        const perm = projectService.checkPermission('handoff', undefined, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const targetPath = projectService.getRequiredProject(project).path;
        const result = await memoryService.readHandoff(targetPath, path || file_path);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to read handoff: ${err.message}` }] };
      }
    }
  );

  // 18. write_handoff
  registerTool(
    'write_handoff',
    'Write/update session handoff document with exact markdown content or summary/next_steps. Defaults to non-intrusive server storage (.chat-dev/handoff.md).',
    {
      path: z.string().optional().describe('Optional custom relative file path for handoff (e.g. HANDOFF.md or .chat-dev/handoff.md)'),
      file_path: z.string().optional().describe('Alias for path'),
      content: z.string().optional().describe('Exact raw Markdown content string to write directly to handoff file without template headers'),
      markdown: z.string().optional().describe('Alias for content'),
      summary: z.string().optional().describe('Summary of what was accomplished in this session'),
      next_steps: z.array(z.string()).optional().describe('List of pending TODO items / next tasks for the next session'),
      persist: z.enum(['server', 'workspace']).optional().describe('Storage mode: "server" (.chat-dev/handoff.md, default) or "workspace" (HANDOFF.md in root)'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ path, file_path, content, markdown, summary, next_steps, persist = 'server', project }) => {
      try {
        const perm = projectService.checkPermission('handoff', undefined, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const targetPath = projectService.getRequiredProject(project).path;
        const result = await memoryService.writeHandoff(targetPath, {
          path: path || file_path,
          content: content || markdown,
          summary: summary || '',
          nextSteps: next_steps || [],
          persist,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to write handoff: ${err.message}` }] };
      }
    }
  );

  // --- SPECIALIZED SKILLS TOOLS ---

  // 19. list_skills
  registerTool(
    'list_skills',
    'List all available domain skills and runbooks (.skills/) registered in the active or specified project workspace.',
    {
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ project }) => {
      try {
        const verifiedProject = projectService.getRequiredProject(project);
        const verified = { project: verifiedProject };
        const canUseSkills = verified.project.permissions.canUseSkills !== false;
        const skills = projectService.getAvailableSkillsSync(verified.project.path, canUseSkills);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  project: verified.project.name,
                  skillsEnabled: canUseSkills,
                  totalSkills: skills.length,
                  skills,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to list skills: ${err.message}` }] };
      }
    }
  );

  // 20. read_skill
  registerTool(
    'read_skill',
    'Read the detailed instructions and runbook (SKILL.md) for a specific project workspace on-demand.',
    {
      skill_name: z.string().describe('The name of the skill to read (e.g. systematic-debugging, test-driven-development)'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ skill_name, project }) => {
      try {
        const verifiedProject = projectService.getRequiredProject(project);
        const verified = { project: verifiedProject };
        const canUseSkills = verified.project.permissions.canUseSkills !== false;
        const detail = await projectService.readSkill(verified.project.path, skill_name, canUseSkills);
        return {
          content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to read skill: ${err.message}` }] };
      }
    }
  );

  // --- PHASE 1 ADVANCED DEVELOPER TOOLS ---

  // 21. apply_patch
  registerTool(
    'apply_patch',
    'Apply multi-file or multi-block surgical code edits in a single operation. Supports unified diff format (patch/diff) or structured file ops (files/chunks).',
    {
      patch: z.string().optional().describe('Unified diff text format (alias for diff)'),
      diff: z.string().optional().describe('Standard Unified Diff string format (alias for patch)'),
      files: z.array(z.any()).optional().describe('Structured list of file operations (alias for chunks)'),
      chunks: z
        .array(
          z.object({
            filePath: z.string().optional().describe('Relative file path within project to patch'),
            path: z.string().optional().describe('Alias for filePath'),
            targetContent: z.string().optional().describe('Exact text to find and replace'),
            replacementContent: z.string().optional().describe('New content to replace with'),
            allowMultiple: z.boolean().optional().describe('Allow multiple replacements'),
            operations: z.array(z.any()).optional(),
          })
        )
        .optional()
        .describe('List of structured patch chunks'),
      cwd: z.string().optional().describe('Custom working directory relative to project root'),
      project: z.string().describe('Required registered project name or id'),
    },
    async (args: any) => {
      try {
        const { cwd, project } = args;
        const perm = projectService.checkPermission('write', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }

        const diffInput = args.diff || args.patch;
        const chunksInput = args.chunks || args.files;

        let result;
        if (chunksInput && Array.isArray(chunksInput) && chunksInput.length > 0) {
          const normalizedChunks = chunksInput.map((c: any) => ({
            filePath: c.filePath || c.path,
            targetContent: c.targetContent,
            replacementContent: c.replacementContent,
            allowMultiple: c.allowMultiple,
            operations: c.operations,
          }));
          result = await patchService.applyStructuredPatch(normalizedChunks, { customCwd: cwd, project });
        } else if (diffInput && typeof diffInput === 'string' && diffInput.trim()) {
          result = await patchService.applyUnifiedDiff(diffInput, { customCwd: cwd, project });
        } else {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Must provide patch/diff (unified diff text) or files/chunks (structured replace operations). Example payload: { "patch": "--- a/file.txt\\n+++ b/file.txt\\n@@ -1 +1 @@\\n-old\\n+new" }',
              },
            ],
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        const patchError = serializePatchError(err);
        return {
          isError: true,
          content: [{ type: 'text', text: patchError ? JSON.stringify(patchError, null, 2) : `Failed to apply patch: ${err.message}` }],
        };
      }
    }
  );

  // 22. git_log
  registerTool(
    'git_log',
    'View recent Git commit history (hash, author, date, message) for the specified project repository.',
    {
      max_count: z.number().optional().describe('Number of recent commits to return (default: 10)'),
      cwd: z.string().optional().describe('Custom working directory relative to project root'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ max_count, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('read', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }

        const result = await gitService.getLog({ maxCount: max_count, customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get git log: ${err.message}` }] };
      }
    }
  );

  // 23. git_commit
  registerTool(
    'git_commit',
    'Stage files and create a Git commit with a descriptive commit message directly from chat.',
    {
      message: z.string().describe('Descriptive Git commit message'),
      files: z.array(z.string()).optional().describe('List of relative file paths to stage (defaults to all changed files: ["."])'),
      cwd: z.string().optional().describe('Custom working directory relative to project root'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ message, files, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('write', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }

        const result = await gitService.commit({ message, files, customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to commit: ${err.message}` }] };
      }
    }
  );

  // 24. project_diagnostics
  registerTool(
    'project_diagnostics',
    'Run a project diagnostic command and extract structured errors. Explicit command is preferred; auto-detection only uses commands declared by the project and otherwise returns not_configured.',
    {
      task: z
        .enum(['typecheck', 'lint', 'test', 'build', 'all'])
        .describe('Diagnostic task to run: "typecheck", "lint", "test", "build", or "all"'),
      cwd: z.string().optional().describe('Custom working directory relative to project root'),
      command: z.string().optional().describe('Explicit project diagnostic command. Recommended for Python and other projects without declared scripts; it is executed exactly as provided.'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ task, cwd, command, project }) => {
      try {
        const perm = projectService.checkPermission('command', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }

        const result = await diagnosticService.runDiagnostics(task, { customCwd: cwd, project, command });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to run diagnostics: ${err.message}` }] };
      }
    }
  );

  // --- PROJECT SNAPSHOT & STARTUP TOOLS ---

  // 31. get_project_snapshot
  registerTool(
    'get_project_snapshot',
    'Get a 1-call comprehensive project snapshot (Git branch, HEAD, dirty status, recent commits, instructions hash, and handoff). In compact mode, project.rootPath="." explicitly means the root of the selected project, as identified by project.pathScope="project-root". project.isGitRepo means a repository marker was detected; inspect project.gitAccess/git.access and error codes before treating Git state as available or clean.',
    {
      compact: z.boolean().optional().describe('Return compact observation tokens without repeating full instructions or handoff text'),
      known_instruction_hash: z.string().optional().describe('Pass previous instruction SHA256 hash to receive "unchanged: true"'),
      project: z.string().describe('Required registered project name or id'),
      cwd: z.string().optional().describe('Optional working directory inside the selected project; relative paths resolve from its root'),
    },
    async ({ compact, known_instruction_hash, project, cwd }) => {
      try {
        const snapshot = await snapshotService.getSnapshot({
          compact,
          knownInstructionHash: known_instruction_hash,
          project,
          customCwd: cwd,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Snapshot error: ${err.message}` }] };
      }
    }
  );

  // --- SEMANTIC CODE INTELLIGENCE TOOLS ---

  // 32. list_symbols
  registerTool(
    'list_symbols',
    'Extract a structured table of contents for all symbols (classes, interfaces, methods, functions) in a source file (C#, TypeScript, Vue, Python).',
    {
      file_path: z.string().describe('Path to source code file (e.g. "src/services/coordinator.cs")'),
      project: z.string().describe('Required registered project name or id'),
      cwd: z.string().optional().describe('Custom working directory'),
    },
    async ({ file_path, project, cwd }) => {
      try {
        const result = await symbolService.listSymbols(file_path, { customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List symbols error: ${err.message}` }] };
      }
    }
  );

  // 33. read_symbol
  registerTool(
    'read_symbol',
    'Read the exact implementation of a specific class, method, or function without loading hundreds of lines of unrelated code.',
    {
      file_path: z.string().describe('Path to source file (e.g. "ControlledActionCoordinator.cs")'),
      symbol_name: z.string().describe('Name of the symbol, class, or method (e.g. "RevokePeriodAsync" or "ControlledActionCoordinator.RevokePeriodAsync")'),
      project: z.string().describe('Required registered project name or id'),
      cwd: z.string().optional().describe('Custom working directory'),
    },
    async ({ file_path, symbol_name, project, cwd }) => {
      try {
        const result = await symbolService.readSymbol(file_path, symbol_name, { customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Read symbol error: ${err.message}` }] };
      }
    }
  );

  // --- GIT WORKTREE & BRANCH STATE TOOLS ---

  // 34. git_sync_status
  registerTool(
    'git_sync_status',
    'Check git upstream synchronization status (ahead, behind, unpushed commits, clean working tree, and workspace fingerprint).',
    {
      cwd: z.string().optional().describe('Custom working directory relative to project root'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ cwd, project }) => {
      try {
        const result = await gitWorkflowService.getSyncStatus(cwd, project);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Git sync status error: ${err.message}` }] };
      }
    }
  );

  // 35. list_worktrees
  registerTool(
    'list_worktrees',
    'List all active Git worktrees linked to this repository with HEAD hash, branch, and current directory indicators.',
    {
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ cwd, project }) => {
      try {
        const result = await gitWorkflowService.listWorktrees(cwd, project);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `List worktrees error: ${err.message}` }] };
      }
    }
  );

  // 36. compare_branches
  registerTool(
    'compare_branches',
    'Compare two Git branches, calculating common merge-base, ahead/behind counts, commit logs, and diff summary in 1 call.',
    {
      base_branch: z.string().describe('Base branch name (e.g. "main" or "origin/main")'),
      target_branch: z.string().optional().describe('Target branch name (default: "HEAD")'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ base_branch, target_branch = 'HEAD', cwd, project }) => {
      try {
        const result = await gitWorkflowService.compareBranches(base_branch, target_branch, cwd, project);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Compare branches error: ${err.message}` }] };
      }
    }
  );

  // --- DIAGNOSTICS & VERIFICATION TOOLS ---

  // 37. build_diagnostics
  registerTool(
    'build_diagnostics',
    'Run compiler/build check (dotnet or tsc) and extract structured errors/warnings while preserving unparsed error lines.',
    {
      target: z.enum(['dotnet', 'tsc', 'custom']).optional().describe('Build system target (default: "dotnet")'),
      custom_command: z.string().optional().describe('Optional custom build command (e.g. "dotnet build --no-restore")'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ target, custom_command, cwd, project }) => {
      try {
        const result = await diagnosticParserService.runBuildDiagnostics({
          target,
          customCommand: custom_command,
          customCwd: cwd,
          project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Build diagnostics error: ${err.message}` }] };
      }
    }
  );


  // 38. find_references
  registerTool(
    'find_references',
    'Find all references and usages of a class, function, or symbol across the codebase.',
    {
      symbol_name: z.string().describe('Name of the symbol/function/class to find usages for (e.g. "FinancialCorrectionCoordinator")'),
      file_pattern: z.string().optional().describe('Optional glob pattern to restrict search files'),
      max_results: z.number().optional().describe('Maximum number of matches (default: 50)'),
      max_files: z.number().int().positive().max(10000).optional().describe('Maximum source files to scan (default: 1000, maximum: 10000)'),
      timeout_ms: z.number().int().min(1000).max(30000).optional().describe('File discovery timeout in milliseconds (default: 10000, maximum: 30000)'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ symbol_name, file_pattern, max_results, max_files, timeout_ms, cwd, project }) => {
      try {
        const result = await symbolService.findReferences(symbol_name, {
          filePattern: file_pattern,
          maxResults: max_results,
          maxFiles: max_files,
          timeoutMs: timeout_ms,
          customCwd: cwd,
          project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Find references error: ${err.message}` }] };
      }
    }
  );

  // 40. search_context
  registerTool(
    'search_context',
    'Search for text across project files, returning results grouped by file with surrounding context lines.',
    {
      project: z.string().describe('Required registered project name or id'),
      query: z.string().describe('Search query text or regex'),
      context_lines: z.number().optional().describe('Number of lines of context before and after each match (default: 2)'),
      is_regex: z.boolean().optional().describe('Whether query is regex'),
      case_sensitive: z.boolean().optional().describe('Case sensitive match'),
      file_pattern: z.string().optional().describe('Optional file glob pattern'),
      cwd: z.string().optional().describe('Custom working directory'),
      max_results: z.number().optional().describe('Max matching lines (default: 60)'),
    },
    async ({ project, query, context_lines, is_regex, case_sensitive, file_pattern, cwd, max_results }) => {
      try {
        const result = await searchService.searchWithContext(query, {
          contextLines: context_lines,
          isRegex: is_regex,
          caseSensitive: case_sensitive,
          filePattern: file_pattern,
          customCwd: cwd,
          maxResults: max_results,
          project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Search context error: ${err.message}` }] };
      }
    }
  );

  // 41. move_file
  registerTool(
    'move_file',
    'Move or rename a file or directory safely without shell syntax errors.',
    {
      source_path: z.string().describe('Source file path'),
      dest_path: z.string().describe('Destination file path'),
      overwrite: z.boolean().optional().describe('Whether to overwrite destination if it exists (default: false)'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ source_path, dest_path, overwrite, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('write', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const result = await fileService.moveFile(source_path, dest_path, { overwrite, customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Move file error: ${err.message}` }] };
      }
    }
  );

  // 43. hash_file
  registerTool(
    'hash_file',
    'Calculate the exact SHA256 cryptographic hash and byte size of a file.',
    {
      path: z.string().describe('Path to file to hash'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ path: targetPath, cwd, project }) => {
      try {
        const result = await fileService.hashFile(targetPath, { customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Hash file error: ${err.message}` }] };
      }
    }
  );

  // 44. compare_file_content
  registerTool(
    'compare_file_content',
    'Compare two files by hash and size to check if they are byte-identical without shell diff.',
    {
      path_a: z.string().describe('Path to first file'),
      path_b: z.string().describe('Path to second file'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ path_a, path_b, cwd, project }) => {
      try {
        const result = await fileService.compareFileContent(path_a, path_b, { customCwd: cwd, project });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Compare files error: ${err.message}` }] };
      }
    }
  );

  // 45. close_feature_branch
  registerTool(
    'close_feature_branch',
    'Atomic branch-close workflow: verify tests, checkout target branch, merge feature branch, re-verify tests, and delete feature branch.',
    {
      branch_name: z.string().describe('Name of the feature branch to close (e.g. "feat/eng-101")'),
      target_branch: z.string().optional().describe('Target branch to merge into (default: "main")'),
      verification_command: z.string().optional().describe('Optional test verification command (e.g. "dotnet test" or "npm test")'),
      delete_remote: z.boolean().optional().describe('Whether to also delete remote branch on origin (default: false)'),
      cwd: z.string().optional().describe('Custom working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ branch_name, target_branch, verification_command, delete_remote, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('command', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const result = await gitWorkflowService.closeFeatureBranch({
          branchName: branch_name,
          targetBranch: target_branch,
          verificationCommand: verification_command,
          deleteRemote: delete_remote,
          customCwd: cwd,
          project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Close feature branch error: ${err.message}` }] };
      }
    }
  );

  // 46. workspace_health
  registerTool(
    'workspace_health',
    'Fast 1-call comprehensive workspace health & state hub: returns git status, compiler diagnostics, running background servers, and project permissions in a single roundtrip. A detected repository with gitAccess="denied" or "unavailable" requires attention and is not considered clean.',
    {
      cwd: z.string().optional().describe('Optional custom directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ cwd, project }) => {
      try {
        const health = await workspaceHealthService.getHealth({
          customCwd: cwd,
          project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(health, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Workspace health error: ${err.message}` }] };
      }
    }
  );

  // 47. run_tests
  registerTool(
    'run_tests',
    'Run project test suite across TypeScript, JavaScript, Python, Go, Rust, Java, or custom runner. Returns structured passed/failed counts, duration, and failure diagnostics without messy ANSI output.',
    {
      customCommand: z.string().optional().describe('Custom test command to run (e.g. npm test, pytest -k test_auth, cargo test)'),
      testFilter: z.string().optional().describe('Optional filter/pattern to run specific test files or names'),
      cwd: z.string().optional().describe('Working directory for test execution'),
      project: z.string().describe('Required registered project name or id'),
      timeoutMs: z.number().optional().describe('Max timeout in ms (default: 60000)'),
    },
    async ({ customCommand, testFilter, cwd, project, timeoutMs }) => {
      try {
        const perm = projectService.checkPermission('command', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const result = await testRunnerService.runTests({
          customCommand,
          testFilter,
          customCwd: cwd,
          project,
          timeoutMs,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Test runner error: ${err.message}` }] };
      }
    }
  );

  // 48. process_manager
  registerTool(
    'process_manager',
    'Structured background process & dev server lifecycle manager: start, stop, restart, view logs, or list active background processes.',
    {
      action: z.enum(['start', 'stop', 'restart', 'logs', 'list']).describe('Action to perform'),
      command: z.string().optional().describe('Command to run for start or restart (e.g. npm run dev)'),
      processId: z.string().optional().describe('Task/Process ID to stop, restart, or inspect logs'),
      cwd: z.string().optional().describe('Working directory'),
      lines: z.number().optional().describe('Number of log lines to tail (default: 50)'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ action, command, processId, cwd, lines, project }) => {
      try {
        const perm = projectService.checkPermission('command', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const result = await processService.manageProcess({
          action,
          command,
          processId,
          cwd,
          lines,
          projectName: project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Process manager error: ${err.message}` }] };
      }
    }
  );

  // 49. git_branch
  registerTool(
    'git_branch',
    'List all local and remote git branches, view active branch, upstream tracking remote, and ahead/behind commit counts.',
    {
      cwd: z.string().optional().describe('Optional repository working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ cwd, project }) => {
      try {
        const result = await gitWorkflowService.getBranchDetails(cwd, project);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Git branch error: ${err.message}` }] };
      }
    }
  );

  // 50. git_push
  registerTool(
    'git_push',
    'Push committed changes to remote repository with upstream branch tracking, safety checks, and rejection handling.',
    {
      branch: z.string().optional().describe('Target branch to push (defaults to current active branch)'),
      remote: z.string().optional().describe('Remote name (default: origin)'),
      setUpstream: z.boolean().optional().describe('Set upstream tracking branch (-u)'),
      force: z.boolean().optional().describe('Force push with lease (--force-with-lease)'),
      dryRun: z.boolean().optional().describe('Simulate push without actually sending data (--dry-run)'),
      cwd: z.string().optional().describe('Optional repository working directory'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ branch, remote, setUpstream, force, dryRun, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('command', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }
        const result = await gitWorkflowService.pushBranch({
          branch,
          remote,
          setUpstream,
          force,
          dryRun,
          customCwd: cwd,
          project,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Git push error: ${err.message}` }] };
      }
    }
  );
}

