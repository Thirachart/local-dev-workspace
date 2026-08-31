import type { ProjectCapabilities } from '../core/permissions.js';

export type ToolCapability = keyof ProjectCapabilities | 'none';
export type SnapshotPolicy = 'none' | 'observe' | 'required';
export type CompatibilityMode = 'legacy-compatible' | 'v2-native';

export interface PublicToolMetadata {
  name: string;
  capability: ToolCapability;
  mutation: boolean;
  snapshotPolicy: SnapshotPolicy;
  audit: boolean;
  compatibility: CompatibilityMode;
}

const definitions: PublicToolMetadata[] = [
  { name: 'list_projects', capability: 'none', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
      { name: 'add_project', capability: 'none', mutation: true, snapshotPolicy: 'none', audit: true, compatibility: 'legacy-compatible' },
  { name: 'remove_project', capability: 'none', mutation: true, snapshotPolicy: 'none', audit: true, compatibility: 'legacy-compatible' },

  { name: 'read_file', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'context_delivery_status', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'write_file', capability: 'write', mutation: true, snapshotPolicy: 'observe', audit: true, compatibility: 'legacy-compatible' },
  { name: 'edit_file', capability: 'write', mutation: true, snapshotPolicy: 'required', audit: true, compatibility: 'legacy-compatible' },
  { name: 'list_directory', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'delete_file', capability: 'write', mutation: true, snapshotPolicy: 'required', audit: true, compatibility: 'legacy-compatible' },
  { name: 'find_files', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'search_files', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'move_file', capability: 'write', mutation: true, snapshotPolicy: 'required', audit: true, compatibility: 'legacy-compatible' },
  { name: 'hash_file', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'compare_file_content', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'apply_patch', capability: 'write', mutation: true, snapshotPolicy: 'required', audit: true, compatibility: 'legacy-compatible' },

  { name: 'run_command', capability: 'runCommands', mutation: true, snapshotPolicy: 'observe', audit: true, compatibility: 'legacy-compatible' },
  { name: 'task_status', capability: 'runCommands', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
  { name: 'task_list', capability: 'runCommands', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
  { name: 'task_kill', capability: 'runCommands', mutation: true, snapshotPolicy: 'none', audit: true, compatibility: 'legacy-compatible' },
  { name: 'project_diagnostics', capability: 'runCommands', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'build_diagnostics', capability: 'runCommands', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },

  { name: 'git_status', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'git_diff', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'git_log', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'git_commit', capability: 'gitCommit', mutation: true, snapshotPolicy: 'required', audit: true, compatibility: 'legacy-compatible' },
  { name: 'git_sync_status', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'list_worktrees', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'compare_branches', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'close_feature_branch', capability: 'deleteBranches', mutation: true, snapshotPolicy: 'required', audit: true, compatibility: 'legacy-compatible' },

  { name: 'workspace_health', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'run_tests', capability: 'runCommands', mutation: false, snapshotPolicy: 'observe', audit: true, compatibility: 'legacy-compatible' },
  { name: 'process_manager', capability: 'runCommands', mutation: true, snapshotPolicy: 'observe', audit: true, compatibility: 'legacy-compatible' },
  { name: 'git_branch', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'git_push', capability: 'gitCommit', mutation: true, snapshotPolicy: 'observe', audit: true, compatibility: 'legacy-compatible' },

  { name: 'read_project_instructions', capability: 'read', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
  { name: 'read_handoff', capability: 'read', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
  { name: 'write_handoff', capability: 'write', mutation: true, snapshotPolicy: 'none', audit: true, compatibility: 'legacy-compatible' },
  { name: 'list_skills', capability: 'read', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
  { name: 'read_skill', capability: 'read', mutation: false, snapshotPolicy: 'none', audit: false, compatibility: 'legacy-compatible' },
  { name: 'get_project_snapshot', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'list_symbols', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'read_symbol', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'find_references', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
  { name: 'search_context', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' },
];

const byName = new Map(definitions.map((definition) => [definition.name, definition]));

export function getPublicToolMetadata(name: string): PublicToolMetadata {
  const metadata = byName.get(name);
  if (!metadata) {
    const err: any = new Error(`[TOOL_METADATA_MISSING] Public tool "${name}" has no security/compatibility metadata.`);
    err.category = 'internal';
    err.code = 'TOOL_METADATA_MISSING';
    throw err;
  }
  return metadata;
}

export function listPublicToolMetadata(): PublicToolMetadata[] {
  return [...definitions];
}
