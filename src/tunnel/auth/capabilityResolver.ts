import { TunnelError } from '../protocol/errors.js';

export const TOOL_CAPABILITY_MAP: Record<string, string> = {
  // Read operations
  read_file: 'file.read',
  context_delivery_status: 'file.read',
  search_files: 'file.read',
  find_files: 'file.read',
  list_directory: 'workspace.read',
  list_projects: 'workspace.read',
  // Active project capability removed; use project-scoped operations.
  get_project_snapshot: 'workspace.read',
  read_symbol: 'code.read',
  list_symbols: 'code.read',
  find_references: 'code.read',
  read_skill: 'skills.read',
  read_handoff: 'handoff.read',

  // Write operations
  write_file: 'file.write',
  edit_file: 'file.write',
  apply_patch: 'file.write',
  delete_file: 'file.write',
  move_file: 'file.write',
  write_handoff: 'handoff.write',

  // Execution operations
  run_command: 'terminal.execute',
  task_status: 'terminal.read',
  task_list: 'terminal.read',
  task_kill: 'terminal.execute',

  // Git operations
  git_status: 'git.read',
  git_diff: 'git.read',
  git_log: 'git.read',
  git_commit: 'git.commit',
  git_checkout: 'git.branch',
  git_sync: 'git.sync',
  git_close_branch: 'git.branch',
  git_compare_branches: 'git.read',
};

export class CapabilityResolver {
  public resolveRequiredCapability(toolName: string): string {
    const normalized = toolName.trim().toLowerCase();
    const mapped = TOOL_CAPABILITY_MAP[normalized];
    if (mapped) return mapped;

    // Fallback based on naming prefix
    if (normalized.startsWith('read_') || normalized.startsWith('get_') || normalized.startsWith('list_') || normalized.startsWith('search_')) {
      return 'workspace.read';
    }
    if (normalized.startsWith('write_') || normalized.startsWith('edit_') || normalized.startsWith('delete_') || normalized.startsWith('apply_')) {
      return 'file.write';
    }
    if (normalized.startsWith('run_') || normalized.startsWith('exec_')) {
      return 'terminal.execute';
    }
    if (normalized.startsWith('git_')) {
      return 'git.commit';
    }

    return 'workspace.read';
  }

  public assertCapability(grantedCapabilities: string[], requiredCapability: string, toolName: string): void {
    if (grantedCapabilities.includes('*') || grantedCapabilities.includes(requiredCapability)) {
      return;
    }

    // Check category wildcard (e.g. "file.*" matches "file.read")
    const [category] = requiredCapability.split('.');
    if (category && grantedCapabilities.includes(`${category}.*`)) {
      return;
    }

    throw new TunnelError(
      'CAPABILITY_DENIED',
      'permission',
      `Access denied: Tool '${toolName}' requires capability '${requiredCapability}', but granted capabilities are [${grantedCapabilities.join(', ')}].`,
      { tool: toolName, requiredCapability, grantedCapabilities }
    );
  }
}
