export type ErrorCategory = 'conflict' | 'validation' | 'permission' | 'execution' | 'internal';

export interface WorkspaceTarget {
  project?: string;      // Optional registered project name (defaults to active project)
  cwd?: string;          // Relative path inside project root (defaults to ".")
}

export interface SnapshotGuard {
  expectedSnapshotId?: string;       // Coarse workspace guard
  expectedSha256?: string;           // Authoritative per-file CAS guard
  staleBehavior?: 'fail' | 'refresh'; // Default: 'fail' for mutations, 'refresh' for reads
}

export interface OutputControl {
  detail?: 'minimal' | 'normal' | 'full';
  maxItems?: number;
  maxChars?: number;
  includeRaw?: boolean;
}

export interface CommonRequest extends WorkspaceTarget, SnapshotGuard, OutputControl {
  schemaVersion?: '2.0';
}

export interface ToolWarning {
  code:
    | 'OUTPUT_TRUNCATED'
    | 'INDEX_STALE'
    | 'HEURISTIC_RESULT'
    | 'PARTIAL_PARSE'
    | 'DIRTY_WORKTREE'
    | 'NO_UPSTREAM'
    | 'CONCURRENT_WORKTREE_ACTIVITY'
    | 'BASELINE_WARNING'
    | 'NON_ATOMIC_FILESYSTEM';
  message: string;
}

export interface ToolMeta {
  schemaVersion: '2.0';
  operationId: string;
  project: string;
  cwd: string;
  snapshotId?: string;
  snapshotBefore?: string;
  snapshotAfter?: string;
  durationMs: number;
  warnings?: ToolWarning[];
}

export interface ToolErrorPayload {
  category: ErrorCategory;
  code:
    | 'PROJECT_NOT_FOUND'
    | 'FILE_NOT_FOUND'
    | 'SYMBOL_NOT_FOUND'
    | 'AMBIGUOUS_MATCH'
    | 'STALE_SNAPSHOT'
    | 'HASH_MISMATCH'
    | 'CONCURRENCY_CONFLICT'
    | 'READ_ONLY_VIOLATION'
    | 'PATCH_CONFLICT'
    | 'PERMISSION_DENIED'
    | 'COMMAND_FAILED'
    | 'TIMEOUT'
    | 'PARSE_INCOMPLETE'
    | 'UNSUPPORTED_LANGUAGE'
    | 'UNSUPPORTED_SCHEMA_VERSION'
    | 'INVALID_STALE_BEHAVIOR'
    | 'DIRTY_WORKTREE'
    | 'GIT_CONFLICT'
    | 'PTY_UNAVAILABLE'
    | 'ATOMIC_REPLACE_UNAVAILABLE'
    | 'ATOMIC_REPLACE_FAILED'
    | 'INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ToolResponse<T> {
  ok: true;
  data: T;
  meta: ToolMeta;
}

export interface ToolFailure {
  ok: false;
  error: ToolErrorPayload;
  meta: ToolMeta;
}

export interface WorkspaceObservation {
  snapshotId: string;
  projectId: string;
  git: {
    branch: string | null;
    head: string;
    headShort: string;
    indexTree: string;
    dirty: boolean;
    stagedCount: number;
    modifiedCount: number;
    untrackedCount: number;
    untrackedAndDirtyHashes: Record<string, string>;
  };
  instructionsCombinedHash: string;
}
