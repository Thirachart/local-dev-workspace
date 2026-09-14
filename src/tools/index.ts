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
import { ProductivityService } from '../services/productivityService.js';
import { ContextLedger } from '../context/contextLedger.js';
import { DeliveryPlanner } from '../context/deliveryPlanner.js';
import { sha256Content } from '../context/contentFingerprint.js';
import { DeliveryScopeResolver } from '../context/deliveryScope.js';
import { getPublicToolMetadata } from './registry.js';
import { ProjectPermissionGuard } from '../core/permissions.js';
import { SnapshotManager } from '../core/snapshotManager.js';
import { AuditLogger } from '../core/auditLogger.js';
import { Logger } from '../utils/logger.js';
import { safeGitCommit } from '../git-intel/commitService.js';

type ToolExtra = { sessionId?: string } | undefined;

type StandardToolError = {
  errorCode: string;
  category: 'validation' | 'conflict' | 'permission' | 'not_found' | 'timeout' | 'process' | 'internal';
  retryable: boolean;
  message: string;
  suggestedAction: string;
};

function buildStandardToolError(input: any, toolName: string): StandardToolError {
  const rawMessage = typeof input === 'string' ? input : input?.message || String(input || 'Unknown tool error');
  const bracketCode = rawMessage.match(/^\[([A-Z0-9_]+)\]/)?.[1];
  const errorCode = input?.code || bracketCode || 'TOOL_ERROR';
  const upper = `${errorCode} ${rawMessage}`.toUpperCase();
  let category: StandardToolError['category'] = input?.category || 'internal';
  if (!input?.category) {
    if (upper.includes('PERMISSION') || upper.includes('SECURITY')) category = 'permission';
    else if (upper.includes('NOT_FOUND') || upper.includes('NOT FOUND') || upper.includes('DOES NOT EXIST')) category = 'not_found';
    else if (upper.includes('CONFLICT') || upper.includes('STALE') || upper.includes('ALREADY EXISTS')) category = 'conflict';
    else if (upper.includes('TIMEOUT') || upper.includes('TIMED OUT')) category = 'timeout';
    else if (upper.includes('REQUIRED') || upper.includes('INVALID') || upper.includes('MUST ')) category = 'validation';
    else if (upper.includes('PROCESS') || upper.includes('COMMAND')) category = 'process';
  }
  const retryable = category === 'timeout' || errorCode === 'STALE_SNAPSHOT';
  const suggestedAction = errorCode === 'STALE_SNAPSHOT'
    ? 'Refresh the project snapshot and retry with the new workspaceObservationId.'
    : category === 'validation'
      ? 'Correct the request parameters and retry.'
      : category === 'not_found'
        ? 'Verify the requested project, path, task, or resource exists.'
        : category === 'permission'
          ? 'Review project permissions or choose an allowed operation.'
          : category === 'timeout'
            ? 'Check task_status or retry with an appropriate timeout.'
            : `Inspect the ${toolName} error details before retrying.`;
  return { errorCode, category, retryable, message: rawMessage, suggestedAction };
}

function normalizeToolErrorResult(result: any, toolName: string): any {
  if (!result?.isError || result?.structuredContent?.error) return result;
  const message = result?.content?.find?.((item: any) => item?.type === 'text')?.text || `Tool ${toolName} failed.`;
  return { ...result, structuredContent: { error: buildStandardToolError(message, toolName) } };
}

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
  const productivityService = new ProductivityService(fileService, patchService, projectService);
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
          expected_snapshot_id: metadata.snapshotPolicy === 'required'
            ? z.string().min(1).describe('Required workspace observation token from get_project_snapshot.workspaceObservationId.')
            : z.string().optional().describe('Optional workspace observation token. Observe-policy tools validate it when supplied.'),
        };

    return (server.tool as any)(name, description, effectiveSchema, async (args: any = {}, ...rest: any[]) => {
      const startedAt = Date.now();
      const project = args?.project as string | undefined;
      const cwd = args?.cwd as string | undefined;
      const targetPath = args?.path || args?.targetPath || args?.file_path || args?.target_path || args?.dest_path || args?.source_path;

      try {
        if (metadata.capability !== 'none') {
          permissionGuard.assertAllowed(metadata.capability, targetPath, { project, customCwd: cwd });
        }

        let snapshotBefore: string | undefined;
        if (metadata.snapshotPolicy !== 'none') {
          snapshotBefore = (await coreSnapshotManager.getObservationToken(cwd, project)).snapshotId;
          if (metadata.snapshotPolicy === 'required' && !args?.expected_snapshot_id) {
            const err: any = new Error(`[SNAPSHOT_REQUIRED] Tool "${name}" requires expected_snapshot_id from a current workspace observation.`);
            err.category = 'validation';
            err.code = 'SNAPSHOT_REQUIRED';
            throw err;
          }
          if (args?.expected_snapshot_id && args.expected_snapshot_id !== snapshotBefore) {
            const err: any = new Error(`[STALE_SNAPSHOT] Expected "${args.expected_snapshot_id}" but found "${snapshotBefore}".`);
            err.category = 'conflict';
            err.code = 'STALE_SNAPSHOT';
            throw err;
          }
        }

        const rawResult = await handler(args, ...rest);
        const result = normalizeToolErrorResult(rawResult, name);
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
        const standardError = buildStandardToolError(err, name);
        return {
          isError: true,
          content: [{ type: 'text', text: `${err.code ? `[${err.code}] ` : ''}${err.message || String(err)}` }],
          structuredContent: { error: standardError },
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
    'Register an existing project directory in the workspace registry. Fails if the path does not exist; use create_project to create a new directory intentionally.',
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
              text: JSON.stringify({ message: `Project '${result.name}' registered successfully`, project: projectService.sanitizeProjectForClient(result) }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to add project: ${err.message}` }] };
      }
    }
  );

  // 4b. create_project
  registerTool(
    'create_project',
    'Create a new project directory and register it. Fails if the target path already exists so typos cannot silently create the wrong workspace.',
    {
      name: z.string().describe('Unique name for the new project'),
      path: z.string().describe('New directory path to create and register'),
      description: z.string().optional().describe('Short description of the project'),
    },
    async ({ name, path: projectPath, description }) => {
      try {
        const result = await projectService.createProject({ name, path: projectPath, description });
        return {
          content: [{ type: 'text', text: JSON.stringify({ message: `Project '${result.name}' created successfully`, project: projectService.sanitizeProjectForClient(result) }, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to create project: ${err.message}` }] };
      }
    }
  );

  // 5. prepare_project_removal
  registerTool(
    'prepare_project_removal',
    'Prepare a destructive project-folder deletion and return a short-lived confirmation token bound to the current target fingerprint.',
    {
      name: z.string().describe('The project name or id to prepare for destructive removal'),
    },
    async ({ name }) => {
      try {
        const result = await projectService.prepareProjectRemoval(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to prepare project removal: ${err.message}` }] };
      }
    }
  );

  // 6. remove_project
  registerTool(
    'remove_project',
    'Remove/unregister a project. Deleting files requires a confirmation token from prepare_project_removal.',
    {
      name: z.string().describe('The name of the project to remove'),
      delete_files: z.boolean().optional().describe('Whether to delete the project folder from disk completely (default false)'),
      confirmation_token: z.string().optional().describe('Required when delete_files=true; obtain from prepare_project_removal.'),
    },
    async ({ name, delete_files = false, confirmation_token }) => {
      try {
        const result = await projectService.removeProject(name, delete_files, confirmation_token);
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
    'Create or replace a file using an atomic write. Existing files require explicit replace_if_hash or force mode.',
    {
      project: z.string().describe('Required registered project name or id'),
      path: z.string().describe('Relative or absolute path to the file to create or overwrite'),
      content: z.string().describe('The complete file content to write'),
      mode: z.enum(['create_only', 'replace_if_hash', 'force']).optional().describe('Write mode. Defaults to create_only; force must be explicit.'),
      expected_before_hash: z.string().optional().describe('Required SHA256 for replace_if_hash; optional extra CAS guard for force.'),
      cwd: z.string().optional().describe('Optional custom working directory'),
    },
    async ({ project, path, content, mode, expected_before_hash, cwd }) => {
      try {
        const journaled = await productivityService.journalMutation('write', [path], { project, cwd }, () =>
          fileService.writeFile(path, content, {
            customCwd: cwd,
            project,
            mode,
            expectedBeforeHash: expected_before_hash,
          }),
        );
        const result = { ...journaled.result, operationId: journaled.mutation.operationId, undoAvailable: journaled.mutation.undoable };
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
        const journaled = await productivityService.journalMutation('edit', [path], { project, cwd }, () =>
          fileService.editFile(path, target_content, replacement_content, {
            allowMultiple: allow_multiple,
            expectedBeforeHash: expected_before_hash,
            customCwd: cwd,
            project,
          }),
        );
        const result = { ...journaled.result, operationId: journaled.mutation.operationId, undoAvailable: journaled.mutation.undoable };
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
        const journaled = await productivityService.journalMutation('delete', [path], { project, cwd }, () =>
          fileService.deleteFile(path, { force, customCwd: cwd, project }),
        );
        const result = { ...journaled.result, operationId: journaled.mutation.operationId, undoAvailable: journaled.mutation.undoable };
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
      detach_on_timeout: z.boolean().optional().describe('For synchronous commands only: keep the process running after timeout and return a task ID. Defaults to false, so timed-out foreground commands are terminated.'),
    },
    async ({ project, command, cwd, timeout_ms, is_daemon, detach_on_timeout }) => {
      try {
        const result = await processService.runCommand({
          command,
          cwd,
          timeoutMs: timeout_ms,
          isDaemon: is_daemon,
          detachOnTimeout: detach_on_timeout,
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
    'Compatibility alias for process_manager logs/status. Check a background task and read recent output without changing it.',
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
    'Compatibility alias for process_manager list. List background tasks with optional status/time filters, bounded result count, and stable finished durations.',
    {
      project: z.string().describe('Required registered project name or id'),
      status: z.enum(['all', 'running', 'completed', 'failed', 'killed']).optional().describe('Filter by task status (default all)'),
      since: z.string().optional().describe('Only include tasks started at or after this ISO-8601 timestamp'),
      limit: z.number().int().positive().max(500).optional().describe('Maximum tasks to return (default 50)'),
      sort: z.enum(['newest', 'oldest']).optional().describe('Sort by start time (default newest)'),
    },
    async ({ project, status, since, limit, sort }) => {
      try {
        const sinceMs = since ? Date.parse(since) : undefined;
        if (since && !Number.isFinite(sinceMs)) {
          throw Object.assign(new Error('since must be a valid ISO-8601 timestamp.'), { code: 'INVALID_TIME_FILTER', category: 'validation' });
        }
        const result = processService.listTasks(project, {
          status: status && status !== 'all' ? status : undefined,
          sinceMs,
          limit: limit || 50,
          sort: sort || 'newest',
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: result.length, limit: limit || 50, sort: sort || 'newest', tasks: result }, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Failed to list tasks: ' + err.message }],
        };
      }
    }
  );

  // 11. task_kill
  registerTool(
    'task_kill',
    'Compatibility alias for process_manager stop. Stop a running background task process.',
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
    'Write/update session handoff document with exact markdown content or summary/next_steps. Defaults to non-intrusive server storage outside the project working tree.',
    {
      path: z.string().optional().describe('Optional custom relative file path for handoff (e.g. HANDOFF.md or .chat-dev/handoff.md)'),
      file_path: z.string().optional().describe('Alias for path'),
      content: z.string().optional().describe('Exact raw Markdown content string to write directly to handoff file without template headers'),
      markdown: z.string().optional().describe('Alias for content'),
      summary: z.string().optional().describe('Summary of what was accomplished in this session'),
      next_steps: z.array(z.string()).optional().describe('List of pending TODO items / next tasks for the next session'),
      persist: z.enum(['server', 'workspace']).optional().describe('Storage mode: "server" (default, outside the project working tree) or "workspace" (HANDOFF.md in root)'),
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
          const patchPaths = productivityService.extractPatchPaths({ chunks: normalizedChunks });
          const journaled = await productivityService.journalMutation('patch', patchPaths, { project, cwd }, () =>
            patchService.applyStructuredPatch(normalizedChunks, { customCwd: cwd, project }),
          );
          result = { ...journaled.result, operationId: journaled.mutation.operationId, undoAvailable: journaled.mutation.undoable };
        } else if (diffInput && typeof diffInput === 'string' && diffInput.trim()) {
          const patchPaths = productivityService.extractPatchPaths({ diff: diffInput });
          const journaled = await productivityService.journalMutation('patch', patchPaths, { project, cwd }, () =>
            patchService.applyUnifiedDiff(diffInput, { customCwd: cwd, project }),
          );
          result = { ...journaled.result, operationId: journaled.mutation.operationId, undoAvailable: journaled.mutation.undoable };
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
    'Safely stage files and create a Git commit with snapshot/Git/file-hash guards and optional pre-commit verification.',
    {
      message: z.string().describe('Descriptive Git commit message'),
      files: z.array(z.string()).optional().describe('List of relative file paths to stage (defaults to all changed files: ["."])'),
      expected_snapshot_id: z.string().min(1).describe('Required workspace observation token from get_project_snapshot.workspaceObservationId.'),
      expected_git_observation_id: z.string().optional().describe('Optional Git observation id to reject HEAD/index drift.'),
      expected_file_hashes: z.record(z.string()).optional().describe('Optional mapping of relative file path to expected SHA256 before staging.'),
      verification_command: z.string().optional().describe('Optional command that must pass before staging.'),
      allow_empty: z.boolean().optional().describe('Allow an empty Git commit (default false).'),
      cwd: z.string().optional().describe('Custom working directory relative to project root'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ message, files, expected_snapshot_id, expected_git_observation_id, expected_file_hashes, verification_command, allow_empty, cwd, project }) => {
      try {
        const perm = projectService.checkPermission('write', cwd, project);
        if (!perm.allowed) {
          return { isError: true, content: [{ type: 'text', text: perm.reason || 'Permission denied' }] };
        }

        const workingDir = projectService.resolveWorkingDir(cwd, project);
        const result = await safeGitCommit(processService, workingDir, {
          message,
          files,
          project,
          expectedSnapshotId: expected_snapshot_id,
          expectedGitObservationId: expected_git_observation_id,
          expectedFileHashes: expected_file_hashes,
          verificationCommand: verification_command,
          allowEmpty: allow_empty,
        }, coreSnapshotManager);
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
        const observation = await coreSnapshotManager.getObservationToken(cwd, project);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ...snapshot,
            workspaceObservationId: observation.snapshotId,
          }, null, 2) }],
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
        const journaled = await productivityService.journalMutation('move', [source_path, dest_path], { project, cwd }, () =>
          fileService.moveFile(source_path, dest_path, { overwrite, customCwd: cwd, project }),
        );
        const result = { ...journaled.result, operationId: journaled.mutation.operationId, undoAvailable: journaled.mutation.undoable };
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
      status: z.enum(['all', 'running', 'completed', 'failed', 'killed']).optional().describe('Optional status filter for action=list'),
      since: z.string().optional().describe('Optional ISO-8601 lower bound for action=list'),
      limit: z.number().int().positive().max(500).optional().describe('Maximum items for action=list (default 50)'),
      sort: z.enum(['newest', 'oldest']).optional().describe('Sort order for action=list'),
      project: z.string().describe('Required registered project name or id'),
    },
    async ({ action, command, processId, cwd, lines, status, since, limit, sort, project }) => {
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
          status,
          since,
          limit,
          sort,
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

  // --- REVERSIBILITY & PRODUCTIVITY (P2) ---
  registerTool(
    'undo_operation',
    'Undo a recorded file mutation only when every current target still matches the mutation after-state (CAS-safe undo).',
    {
      project: z.string().describe('Required registered project name or id'),
      operation_id: z.string().describe('Mutation operation ID returned by write/edit/delete/move/apply_patch/changeset/copy/sync/config patch'),
    },
    async ({ project, operation_id }) => {
      const result = await productivityService.undoOperation(project, operation_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  registerTool(
    'get_mutation',
    'Read persisted mutation-journal metadata without returning backed-up source content.',
    {
      project: z.string().describe('Required registered project name or id'),
      operation_id: z.string().describe('Mutation operation ID'),
    },
    async ({ project, operation_id }) => {
      const result = await productivityService.getMutation(project, operation_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  registerTool(
    'file_changeset',
    'Apply a file-only changeset (write/edit/delete/move/structured patch) with one persisted before-state and automatic rollback if any operation fails.',
    {
      project: z.string().describe('Required registered project name or id'),
      cwd: z.string().optional().describe('Working directory relative to project root'),
      operations: z.array(z.any()).min(1).describe('Ordered file-only operations. Supported types: write, edit, delete, move, patch.'),
    },
    async ({ project, cwd, operations }) => {
      const result = await productivityService.applyChangeset({ project, cwd, operations });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  const copyFileSchema = {
    project: z.string().describe('Required registered project name or id'),
    source_project: z.string().describe('Source registered project name or id'),
    source_path: z.string().describe('Source file path within source_project'),
    target_path: z.string().describe('Target file path within target project'),
    source_cwd: z.string().optional().describe('Optional source-project working directory'),
    target_cwd: z.string().optional().describe('Optional target-project working directory'),
    expected_source_hash: z.string().optional().describe('Optional expected SHA256 of source before copy'),
  };
  const copyFileHandler = (syncOnly: boolean): ((args: any) => Promise<any>) => async ({
    project,
    source_project,
    source_path,
    target_path,
    source_cwd,
    target_cwd,
    expected_source_hash,
  }: any) => {
    const sourcePerm = projectService.checkPermission('read', source_cwd, source_project);
    if (!sourcePerm.allowed) return { isError: true, content: [{ type: 'text', text: sourcePerm.reason || 'Source read permission denied' }] };
    const targetPerm = projectService.checkPermission('write', target_cwd, project);
    if (!targetPerm.allowed) return { isError: true, content: [{ type: 'text', text: targetPerm.reason || 'Target write permission denied' }] };
    const result = await productivityService.copyFile({
      sourceProject: source_project,
      sourcePath: source_path,
      targetProject: project,
      targetPath: target_path,
      sourceCwd: source_cwd,
      targetCwd: target_cwd,
      expectedSourceHash: expected_source_hash,
      syncOnly,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  };
  registerTool(
    'copy_file',
    'Copy one regular file across explicit projects with optional source-hash verification and CAS-safe undo.',
    copyFileSchema,
    copyFileHandler(false),
  );
  registerTool(
    'sync_file',
    'Synchronize one regular file across explicit projects only when content differs, with optional source-hash verification and CAS-safe undo.',
    copyFileSchema,
    copyFileHandler(true),
  );

  const configPatchSchema = {
    project: z.string().describe('Required registered project name or id'),
    path: z.string().describe('JSON or YAML file path'),
    operations: z.array(z.object({
      op: z.enum(['set', 'remove']),
      path: z.string().describe('JSON Pointer path such as /server/port'),
      value: z.any().optional(),
    })).min(1),
    expected_before_hash: z.string().optional().describe('Optional SHA256 CAS guard'),
    cwd: z.string().optional().describe('Working directory relative to project root'),
  };
  registerTool(
    'patch_json',
    'Patch JSON structurally with JSON Pointer set/remove operations and CAS-safe undo.',
    configPatchSchema,
    async ({ project, path, operations, expected_before_hash, cwd }) => {
      const result = await productivityService.patchConfig({ format: 'json', project, path, operations, expectedBeforeHash: expected_before_hash, cwd });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
  registerTool(
    'patch_yaml',
    'Patch YAML structurally with JSON Pointer set/remove operations and CAS-safe undo.',
    configPatchSchema,
    async ({ project, path, operations, expected_before_hash, cwd }) => {
      const result = await productivityService.patchConfig({ format: 'yaml', project, path, operations, expectedBeforeHash: expected_before_hash, cwd });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  registerTool(
    'batch_file_ops',
    'Batch non-mutating file reads, SHA256 hashes, and byte-content comparisons in one call.',
    {
      project: z.string().describe('Required registered project name or id'),
      cwd: z.string().optional().describe('Working directory relative to project root'),
      operations: z.array(z.any()).min(1).max(100).describe('Operations of type hash, read, or compare'),
    },
    async ({ project, cwd, operations }) => {
      const result = await productivityService.batchRead({ project, cwd, operations });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  registerTool(
    'git_stage',
    'Stage explicit repository-relative files without shell interpolation.',
    {
      project: z.string().describe('Required registered project name or id'),
      files: z.array(z.string()).min(1).describe('Repository-relative files to stage'),
      cwd: z.string().optional().describe('Repository working directory'),
    },
    async ({ project, files, cwd }) => ({ content: [{ type: 'text', text: JSON.stringify(await gitService.stage(files, { customCwd: cwd, project }), null, 2) }] }),
  );

  registerTool(
    'git_unstage',
    'Unstage explicit repository-relative files without changing working-tree content.',
    {
      project: z.string().describe('Required registered project name or id'),
      files: z.array(z.string()).min(1).describe('Repository-relative files to unstage'),
      cwd: z.string().optional().describe('Repository working directory'),
    },
    async ({ project, files, cwd }) => ({ content: [{ type: 'text', text: JSON.stringify(await gitService.unstage(files, { customCwd: cwd, project }), null, 2) }] }),
  );

  registerTool(
    'git_show',
    'Read a repository-relative file at a Git revision without checking it out.',
    {
      project: z.string().describe('Required registered project name or id'),
      revision: z.string().describe('Git revision such as HEAD, main, or a commit hash'),
      path: z.string().describe('Repository-relative file path'),
      cwd: z.string().optional().describe('Repository working directory'),
      max_chars: z.number().int().positive().max(500000).optional().describe('Maximum content characters returned (default 100000)'),
    },
    async ({ project, revision, path, cwd, max_chars }) => {
      const result = await gitService.showFile(revision, path, { customCwd: cwd, project });
      const limit = max_chars || 100000;
      const truncated = result.content.length > limit;
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, content: result.content.slice(0, limit), truncated }, null, 2) }] };
    },
  );

  // --- CLEANUP & COMPATIBILITY (P3) ---
  registerTool(
    'project_registry_report',
    'Report missing, duplicate-path, and stale project-registry entries without exposing absolute local paths.',
    {
      stale_after_days: z.number().int().positive().max(3650).optional().describe('Days since last use before an entry is considered stale (default 90)'),
    },
    async ({ stale_after_days }) => {
      const days = stale_after_days || 90;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const projects = projectService.listProjects('global', false, { compact: true }).projects;
      const byPath = new Map<string, typeof projects>();
      for (const project of projects) {
        const key = project.path.toLowerCase().replace(/\\/g, '/');
        const group = byPath.get(key) || [];
        group.push(project);
        byPath.set(key, group);
      }
      const summarize = (project: (typeof projects)[number]) => ({
        id: project.id,
        name: project.name,
        pathExists: project.pathExists,
        lastUsedAt: project.lastUsedAt,
      });
      const missing = projects.filter((project) => project.pathExists === false).map(summarize);
      const stale = projects.filter((project) => {
        const timestamp = Date.parse(project.lastUsedAt || project.updatedAt || project.createdAt);
        return Number.isFinite(timestamp) && timestamp < cutoff;
      }).map(summarize);
      const duplicatePaths = Array.from(byPath.values()).filter((group) => group.length > 1).map((group) => group.map(summarize));
      return { content: [{ type: 'text', text: JSON.stringify({ totalCount: projects.length, staleAfterDays: days, missing, stale, duplicatePaths }, null, 2) }] };
    },
  );
}

