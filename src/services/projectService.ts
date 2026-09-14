import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface GlobalPermissions {
  canRead: boolean;
  canWrite: boolean;
  canRunCommand: boolean;
  canUseSkills: boolean;
  canUseHandoff: boolean;
  canDelete?: boolean;
}

export const DEFAULT_GLOBAL_PERMISSIONS: GlobalPermissions = {
  canRead: true,
  canWrite: true,
  canRunCommand: true,
  canUseSkills: true,
  canUseHandoff: true,
  canDelete: true,
};

export interface ProjectPermissions {
  canRead: boolean;
  canWrite: boolean;
  canRunCommand: boolean;
  canDelete?: boolean;
  canUseSkills?: boolean;
  canUseHandoff?: boolean;
  allowedCommands?: string[];
  blockedCommands?: string[];
}

export interface ProjectInstructions {
  file: string;
  content: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  file: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  description?: string;
  permissions: ProjectPermissions;
  projectInstructions?: ProjectInstructions | null;
  availableSkills?: SkillSummary[];
  systemPrompt?: string;
  createdAt: string;
  updatedAt?: string;
  lastUsedAt?: string;
  pathExists?: boolean;
}

export interface ProjectRemovalPlan {
  projectId: string;
  projectName: string;
  targetPath: '.';
  pathScope: 'project-root';
  exists: boolean;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  fingerprint: string;
  confirmationToken: string;
  expiresAt: string;
}

interface PendingProjectRemoval extends ProjectRemovalPlan {
  resolvedPath: string;
  expiresAtMs: number;
}

export class ProjectService {
  public static readonly INSTRUCTION_FILES = [
    'AGENTS.md',
    'agent.md',
    'CLAUDE.md',
    'claude.md',
    '.chat-dev/memory.md',
  ];

  public static readonly SKILL_DIRECTORIES = [
    '.skills',
    'skills',
    '.agents/skills',
    '.claude/skills',
    '.gemini/skills',
  ];

  private configDir: string;
  private configFile: string;
  private globalPermissionsFile: string;
  private globalPermissions: GlobalPermissions = { ...DEFAULT_GLOBAL_PERMISSIONS };
  private projects: Map<string, ProjectInfo> = new Map();
  private pendingProjectRemovals: Map<string, PendingProjectRemoval> = new Map();
  private readonly projectRemovalTtlMs = 5 * 60 * 1000;

  constructor(baseDir: string = process.cwd()) {
    this.configDir = path.resolve(baseDir, 'config');
    this.configFile = path.join(this.configDir, 'projects.json');
    this.globalPermissionsFile = path.join(this.configDir, 'global-permissions.json');
    this.init(baseDir);
  }

  public getGlobalPermissions(): GlobalPermissions {
    return { ...this.globalPermissions };
  }

  public updateGlobalPermissions(updates: Partial<GlobalPermissions>): GlobalPermissions {
    this.globalPermissions = {
      ...this.globalPermissions,
      ...updates,
    };
    try {
      if (!fsSync.existsSync(this.configDir)) {
        fsSync.mkdirSync(this.configDir, { recursive: true });
      }
      fsSync.writeFileSync(this.globalPermissionsFile, JSON.stringify(this.globalPermissions, null, 2), 'utf-8');
    } catch {}
    return { ...this.globalPermissions };
  }

  private init(defaultBaseDir: string): void {
    if (!fsSync.existsSync(this.configDir)) {
      fsSync.mkdirSync(this.configDir, { recursive: true });
    }

    if (fsSync.existsSync(this.globalPermissionsFile)) {
      try {
        const graw = fsSync.readFileSync(this.globalPermissionsFile, 'utf-8');
        this.globalPermissions = { ...DEFAULT_GLOBAL_PERMISSIONS, ...JSON.parse(graw) };
      } catch {}
    }

    if (fsSync.existsSync(this.configFile)) {
      try {
        const raw = fsSync.readFileSync(this.configFile, 'utf-8');
        const list: ProjectInfo[] = JSON.parse(raw);
        let migrated = false;
        for (const p of list) {
          if ('linearConfig' in p) {
            delete (p as ProjectInfo & { linearConfig?: unknown }).linearConfig;
            migrated = true;
          }
          if (!p.id) {
            p.id = 'proj_' + crypto.randomBytes(4).toString('hex');
          }
          p.permissions = p.permissions || {
            canRead: true,
            canWrite: true,
            canRunCommand: true,
            canUseSkills: true,
            canUseHandoff: true,
          };
          if (p.permissions.canUseSkills === undefined) p.permissions.canUseSkills = true;
          if (p.permissions.canUseHandoff === undefined) p.permissions.canUseHandoff = true;
          this.projects.set(p.id, p);
        }
        if (migrated) {
          fsSync.writeFileSync(this.configFile, JSON.stringify(list, null, 2), 'utf-8');
        }
      } catch {
        // fallback
      }
    }

    if (this.projects.size === 0) {
      const defaultName = path.basename(defaultBaseDir) || 'workspace';
      const id = 'proj_' + crypto.randomBytes(4).toString('hex');
      const defaultProject: ProjectInfo = {
        id,
        name: defaultName,
        path: path.resolve(defaultBaseDir),
        description: `Project workspace for ${defaultName}`,
        permissions: {
          canRead: true,
          canWrite: true,
          canRunCommand: true,
          canUseSkills: true,
          canUseHandoff: true,
        },
        createdAt: new Date().toISOString(),
      };
      this.projects.set(id, defaultProject);
      this.saveProjects();
    }
  }

  public generateSystemPrompt(project: ProjectInfo): string {
    const canUseSkills = project.permissions.canUseSkills !== false;
    const canUseHandoff = project.permissions.canUseHandoff !== false;
    const skills = canUseSkills ? this.getAvailableSkillsSync(project.path, true) : [];
    const skillsListStr = skills.length > 0
      ? skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
      : '  (No specialized skills registered in .skills/)';

    return `You are ChatDev, an expert AI Software Engineer operating strictly within the active project workspace "${project.name}".

### 🚀 Core Operating Rules for "${project.name}":
1. **Workspace Boundary & Relative Paths**:
   - All tool calls execute strictly inside this project. Always use relative paths (e.g. '.', 'src/index.ts', 'package.json'). Never attempt path traversal outside the project root.
2. **Project Instructions**:
   - Strictly follow the project guidelines provided in projectInstructions (AGENTS.md or CLAUDE.md).
${canUseSkills ? `3. **Specialized Skills On-Demand (.skills/)**:
   - When tackling specific tasks (testing, debugging, architecture, deployment), call 'read_skill' to load domain runbooks on-demand without bloating context:
${skillsListStr}` : `3. **Skills Feature**: Disabled for this project.`}
4. **Tool Safety & Permissions**:
   - Read Access: ${project.permissions.canRead ? 'Allowed' : 'Denied'}
   - Write/Edit Access: ${project.permissions.canWrite ? 'Allowed' : 'Denied (Read-Only)'}
   - Terminal Shell Access: ${project.permissions.canRunCommand ? 'Allowed' : 'Denied'}
   - Destructive commands (sudo, rm -rf /, disk formatting, remote pipe-to-shell) are strictly blocked by the system security guard.
${canUseHandoff ? `5. **Memory Compaction & Session Handoff (HANDOFF.md)**:
   - When finishing a milestone or when the conversation gets long, proactively compact current progress and pending TODOs by calling 'write_handoff'.
   - When starting a new session or resuming work, call 'read_handoff' to instantly restore full project context in ~500 tokens.` : `5. **Session Handoff & Memory Compaction**: Disabled for this project.`}
6. **Resilience & Auto-Retry**:
   - If any tool request encounters a temporary network glitch or tunnel timeout, automatically retry the call up to 3 times silently before reporting an error.`;
  }

  public getProjectInstructionsSync(projectPath: string): ProjectInstructions | null {
    const root = path.resolve(projectPath);
    for (const fileName of ProjectService.INSTRUCTION_FILES) {
      const fullPath = path.join(root, fileName);
      if (fsSync.existsSync(fullPath)) {
        try {
          const content = fsSync.readFileSync(fullPath, 'utf-8');
          return { file: fileName, content };
        } catch {
          // continue
        }
      }
    }
    return null;
  }

  public getAvailableSkillsSync(projectPath: string, canUseSkills: boolean = true): SkillSummary[] {
    if (!canUseSkills) {
      return [];
    }

    const root = path.resolve(projectPath);
    const skills: SkillSummary[] = [];

    for (const skillDirRel of ProjectService.SKILL_DIRECTORIES) {
      const skillDirFull = path.join(root, skillDirRel);
      if (fsSync.existsSync(skillDirFull)) {
        try {
          const entries = fsSync.readdirSync(skillDirFull, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory()) {
              const skillName = ent.name;
              const skillFile = path.join(skillDirFull, skillName, 'SKILL.md');
              if (fsSync.existsSync(skillFile)) {
                const desc = this.extractSkillDescription(skillFile, skillName);
                skills.push({
                  name: skillName,
                  description: desc,
                  file: path.join(skillDirRel, skillName, 'SKILL.md'),
                });
              }
            } else if (ent.isFile() && ent.name.endsWith('.md')) {
              const skillName = path.basename(ent.name, '.md');
              const skillFile = path.join(skillDirFull, ent.name);
              const desc = this.extractSkillDescription(skillFile, skillName);
              skills.push({
                name: skillName,
                description: desc,
                file: path.join(skillDirRel, ent.name),
              });
            }
          }
        } catch {
          // continue
        }
      }
    }

    return skills;
  }

  private extractSkillDescription(filePath: string, fallbackName: string): string {
    try {
      const text = fsSync.readFileSync(filePath, 'utf-8');
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      const descMatch = text.match(/description:\s*(.+)/i);
      if (descMatch && descMatch[1]) {
        return descMatch[1].replace(/["']/g, '').trim();
      }

      for (const line of lines) {
        if (!line.startsWith('#') && !line.startsWith('---') && line.length > 10) {
          return line.substring(0, 140).trim();
        }
      }
    } catch {}

    return `Skill runbook for ${fallbackName}`;
  }

  public async readSkill(projectPath: string, skillName: string, canUseSkills: boolean = true): Promise<SkillDetail> {
    if (!canUseSkills) {
      throw new Error(`[PERMISSION DENIED] Skills discovery and execution is disabled for this project.`);
    }

    if (!skillName || typeof skillName !== 'string' || !skillName.trim()) {
      throw new Error('Skill name is required.');
    }

    const clean = skillName.trim().toLowerCase();
    const available = this.getAvailableSkillsSync(projectPath, true);
    const found = available.find(s => s.name.toLowerCase() === clean);

    if (!found) {
      const names = available.map(s => s.name).join(', ');
      throw new Error(`Skill '${skillName}' not found in project. Available skills: [${names || 'none'}]`);
    }

    const fullPath = path.resolve(projectPath, found.file);
    const content = await fs.readFile(fullPath, 'utf-8');

    return {
      name: found.name,
      description: found.description,
      file: found.file,
      content,
    };
  }

  public async saveProjects(): Promise<void> {
    const list = Array.from(this.projects.values()).map(p => {
      const copy = { ...p };
      delete copy.projectInstructions;
      delete copy.availableSkills;
      delete copy.systemPrompt;
      return copy;
    });
    await fs.writeFile(this.configFile, JSON.stringify(list, null, 2), 'utf-8');
  }

  public listProjects(
    sessionId: string = 'global',
    sanitize: boolean = true,
    options?: { limit?: number; offset?: number; compact?: boolean }
  ): { projects: ProjectInfo[]; totalCount: number; limit?: number; offset?: number } {
    let all = Array.from(this.projects.values()).map(p => {
      const base: ProjectInfo = {
        ...p,
        lastUsedAt: p.lastUsedAt || p.updatedAt || p.createdAt,
        pathExists: fsSync.existsSync(p.path),
      };
      if (!sanitize && options?.compact === false) {
        const canUseSkills = p.permissions.canUseSkills !== false;
        base.projectInstructions = this.getProjectInstructionsSync(p.path);
        base.availableSkills = this.getAvailableSkillsSync(p.path, canUseSkills);
        base.systemPrompt = this.generateSystemPrompt(base);
      }
      return sanitize ? this.sanitizeProjectForClient(base) : base;
    });

    const totalCount = all.length;
    const offset = options?.offset && options.offset > 0 ? options.offset : 0;
    const limit = options?.limit && options.limit > 0 ? options.limit : undefined;

    if (limit !== undefined) {
      all = all.slice(offset, offset + limit);
    } else if (offset > 0) {
      all = all.slice(offset);
    }

    return {
      projects: all,
      totalCount,
      limit,
      offset,
    };
  }


  /**
   * Resolve a project explicitly supplied by a tool call.
   * This never falls back to active/session state.
   */
  public getRequiredProject(idOrName: string): ProjectInfo {
    if (!idOrName || typeof idOrName !== 'string' || !idOrName.trim()) {
      throw new Error('Missing required project. Every project-scoped operation must specify a project.');
    }

    const key = idOrName.toLowerCase().trim();
    const target = Array.from(this.projects.values()).find(p =>
      (p.id && p.id.toLowerCase() === key) ||
      (p.name && p.name.toLowerCase() === key) ||
      (p.path && path.resolve(p.path).toLowerCase() === path.resolve(idOrName).toLowerCase())
    );

    if (!target) {
      throw new Error(`Project '${idOrName}' not found in registry.`);
    }

    const canUseSkills = target.permissions.canUseSkills !== false;
    target.lastUsedAt = new Date().toISOString();
    const populated: ProjectInfo = {
      ...target,
      pathExists: fsSync.existsSync(target.path),
      projectInstructions: this.getProjectInstructionsSync(target.path),
      availableSkills: this.getAvailableSkillsSync(target.path, canUseSkills),
    };
    populated.systemPrompt = this.generateSystemPrompt(populated);

    return populated;
  }

  public async addProject(options: {
    name: string;
    path: string;
    description?: string;
    permissions?: Partial<ProjectPermissions>;
  }): Promise<ProjectInfo> {
    if (!options.name || !options.name.trim()) {
      throw new Error('Project name is required.');
    }
    if (!options.path || !options.path.trim()) {
      throw new Error('Project path is required.');
    }

    const resolvedPath = path.resolve(options.path.trim());
    if (!fsSync.existsSync(resolvedPath)) {
      const err: any = new Error(`Project path does not exist: '${options.path}'. Use create_project when a new directory should be created.`);
      err.code = 'PROJECT_PATH_NOT_FOUND';
      err.category = 'validation';
      throw err;
    }
    if (!fsSync.statSync(resolvedPath).isDirectory()) {
      const err: any = new Error(`Project path is not a directory: '${options.path}'.`);
      err.code = 'PROJECT_PATH_NOT_DIRECTORY';
      err.category = 'validation';
      throw err;
    }

    for (const p of this.projects.values()) {
      if (p.name.toLowerCase() === options.name.trim().toLowerCase()) {
        const err: any = new Error(`A project with name '${options.name}' already exists.`);
        err.code = 'PROJECT_NAME_CONFLICT';
        err.category = 'conflict';
        throw err;
      }
      if (path.resolve(p.path).toLowerCase() === resolvedPath.toLowerCase()) {
        const err: any = new Error(`A project pointing to '${options.path}' is already registered as '${p.name}'.`);
        err.code = 'PROJECT_PATH_CONFLICT';
        err.category = 'conflict';
        throw err;
      }
    }

    const id = 'proj_' + crypto.randomBytes(4).toString('hex');
    const newProject: ProjectInfo = {
      id,
      name: options.name.trim(),
      path: resolvedPath,
      description: options.description || `Project workspace for ${options.name.trim()}`,
      permissions: {
        canRead: options.permissions?.canRead ?? true,
        canWrite: options.permissions?.canWrite ?? true,
        canRunCommand: options.permissions?.canRunCommand ?? true,
        canUseSkills: options.permissions?.canUseSkills ?? true,
        canUseHandoff: options.permissions?.canUseHandoff ?? true,
        allowedCommands: options.permissions?.allowedCommands,
        blockedCommands: options.permissions?.blockedCommands,
      },
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };

    this.projects.set(id, newProject);
    await this.saveProjects();

    const populated: ProjectInfo = {
      ...newProject,
      projectInstructions: this.getProjectInstructionsSync(newProject.path),
      availableSkills: this.getAvailableSkillsSync(newProject.path, newProject.permissions.canUseSkills !== false),
    };
    populated.systemPrompt = this.generateSystemPrompt(populated);
    return populated;
  }

  public async createProject(options: {
    name: string;
    path: string;
    description?: string;
    permissions?: Partial<ProjectPermissions>;
  }): Promise<ProjectInfo> {
    if (!options.path || !options.path.trim()) {
      const err: any = new Error('Project path is required.');
      err.code = 'INVALID_PROJECT_PATH';
      err.category = 'validation';
      throw err;
    }

    const resolvedPath = path.resolve(options.path.trim());
    if (fsSync.existsSync(resolvedPath)) {
      const err: any = new Error(`Project path already exists: '${options.path}'. Use add_project to register an existing directory.`);
      err.code = 'PROJECT_PATH_ALREADY_EXISTS';
      err.category = 'conflict';
      throw err;
    }

    await fs.mkdir(resolvedPath, { recursive: true });
    try {
      return await this.addProject({ ...options, path: resolvedPath });
    } catch (err) {
      await fs.rm(resolvedPath, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  }

  public async updateProject(
    idOrName: string,
    updates: Partial<Omit<ProjectInfo, 'id' | 'createdAt'>>
  ): Promise<ProjectInfo> {
    const key = idOrName.toLowerCase().trim();
    let target: ProjectInfo | undefined;

    for (const p of this.projects.values()) {
      if ((p.id && p.id.toLowerCase() === key) || (p.name && p.name.toLowerCase() === key)) {
        target = p;
        break;
      }
    }

    if (!target) {
      throw new Error(`Project '${idOrName}' not found.`);
    }

    if (updates.name) {
      const nextName = updates.name.trim();
      const nameConflict = Array.from(this.projects.values()).find(
        (p) => p.id !== target!.id && p.name.toLowerCase() === nextName.toLowerCase(),
      );
      if (nameConflict) {
        const err: any = new Error(`A project with name '${nextName}' already exists.`);
        err.code = 'PROJECT_NAME_CONFLICT';
        err.category = 'conflict';
        throw err;
      }
      target.name = nextName;
    }
    if (updates.path && updates.path.trim() && updates.path.trim() !== '.') {
      const nextPath = path.resolve(updates.path);
      if (!fsSync.existsSync(nextPath)) {
        const err: any = new Error(`Project path does not exist: '${updates.path}'.`);
        err.code = 'PROJECT_PATH_NOT_FOUND';
        err.category = 'validation';
        throw err;
      }
      if (!fsSync.statSync(nextPath).isDirectory()) {
        const err: any = new Error(`Project path is not a directory: '${updates.path}'.`);
        err.code = 'PROJECT_PATH_NOT_DIRECTORY';
        err.category = 'validation';
        throw err;
      }
      const pathConflict = Array.from(this.projects.values()).find(
        (p) => p.id !== target!.id && path.resolve(p.path).toLowerCase() === nextPath.toLowerCase(),
      );
      if (pathConflict) {
        const err: any = new Error(`Project path is already registered as '${pathConflict.name}'.`);
        err.code = 'PROJECT_PATH_CONFLICT';
        err.category = 'conflict';
        throw err;
      }
      target.path = nextPath;
    }
    if (updates.description !== undefined) target.description = updates.description;
    if (updates.permissions) {
      target.permissions = {
        ...target.permissions,
        ...updates.permissions,
      };
    }
    target.updatedAt = new Date().toISOString();
    await this.saveProjects();
    return target;
  }

  public async removeProject(
    idOrName: string,
    deleteFiles: boolean = false,
    confirmationToken?: string
  ): Promise<{ success: boolean; message: string; remainingProjects: ProjectInfo[] }> {
    if (!idOrName || typeof idOrName !== 'string' || !idOrName.trim()) {
      throw new Error('Missing project identifier.');
    }
    const key = idOrName.toLowerCase().trim();
    let targetKey: string | undefined;
    let target: ProjectInfo | undefined;

    for (const [k, p] of this.projects.entries()) {
      if ((p.id && p.id.toLowerCase() === key) || (p.name && p.name.toLowerCase() === key)) {
        targetKey = k;
        target = p;
        break;
      }
    }

    if (!targetKey || !target) {
      throw new Error(`Project '${idOrName}' not found.`);
    }

    if (deleteFiles) {
      if (!confirmationToken) {
        const err: any = new Error('[DESTRUCTIVE_CONFIRMATION_REQUIRED] Deleting project files requires a confirmation_token from prepare_project_removal.');
        err.category = 'validation';
        err.code = 'DESTRUCTIVE_CONFIRMATION_REQUIRED';
        throw err;
      }

      const pending = this.pendingProjectRemovals.get(confirmationToken);
      if (!pending || pending.projectId !== target.id) {
        const err: any = new Error('[INVALID_CONFIRMATION_TOKEN] Project removal confirmation token is invalid for this project.');
        err.category = 'validation';
        err.code = 'INVALID_CONFIRMATION_TOKEN';
        throw err;
      }
      if (Date.now() > pending.expiresAtMs) {
        this.pendingProjectRemovals.delete(confirmationToken);
        const err: any = new Error('[CONFIRMATION_TOKEN_EXPIRED] Project removal confirmation token has expired.');
        err.category = 'conflict';
        err.code = 'CONFIRMATION_TOKEN_EXPIRED';
        throw err;
      }

      const current = await this.inspectProjectRemovalTarget(target);
      if (current.fingerprint !== pending.fingerprint) {
        const err: any = new Error('[PROJECT_REMOVAL_TARGET_CHANGED] Project contents changed after removal preparation. Prepare removal again before deleting files.');
        err.category = 'conflict';
        err.code = 'PROJECT_REMOVAL_TARGET_CHANGED';
        err.details = { expectedFingerprint: pending.fingerprint, actualFingerprint: current.fingerprint };
        throw err;
      }

      if (fsSync.existsSync(target.path)) {
        await fs.rm(target.path, { recursive: true, force: true });
      }
      this.pendingProjectRemovals.delete(confirmationToken);
    }

    this.projects.delete(targetKey);
    for (const [token, pending] of this.pendingProjectRemovals.entries()) {
      if (pending.projectId === target.id) this.pendingProjectRemovals.delete(token);
    }

    await this.saveProjects();
    return {
      success: true,
      message: `Project '${target.name}' removed successfully.${deleteFiles ? ' (Files deleted)' : ''}`,
      remainingProjects: Array.from(this.projects.values()),
    };
  }

  public async prepareProjectRemoval(idOrName: string): Promise<ProjectRemovalPlan> {
    const target = this.findProjectByIdOrName(idOrName);
    if (!target) {
      throw new Error(`Project '${idOrName}' not found.`);
    }

    const inspected = await this.inspectProjectRemovalTarget(target);
    const confirmationToken = `remove_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAtMs = Date.now() + this.projectRemovalTtlMs;
    const plan: PendingProjectRemoval = {
      projectId: target.id,
      projectName: target.name,
      targetPath: '.',
      pathScope: 'project-root',
      resolvedPath: path.resolve(target.path),
      exists: inspected.exists,
      fileCount: inspected.fileCount,
      directoryCount: inspected.directoryCount,
      totalBytes: inspected.totalBytes,
      fingerprint: inspected.fingerprint,
      confirmationToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    this.pendingProjectRemovals.set(confirmationToken, plan);
    const { expiresAtMs: _internalExpiry, resolvedPath: _internalPath, ...publicPlan } = plan;
    return publicPlan;
  }

  private findProjectByIdOrName(idOrName: string): ProjectInfo | undefined {
    const key = idOrName.toLowerCase().trim();
    return Array.from(this.projects.values()).find(
      (project) => project.id.toLowerCase() === key || project.name.toLowerCase() === key
    );
  }

  private async inspectProjectRemovalTarget(target: ProjectInfo): Promise<{
    exists: boolean;
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    fingerprint: string;
  }> {
    const root = path.resolve(target.path);
    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    const manifest: string[] = [];

    const walk = async (current: string): Promise<void> => {
      const stat = await fs.lstat(current);
      const relative = path.relative(root, current).split(path.sep).join('/') || '.';
      const type = stat.isSymbolicLink() ? 'L' : stat.isDirectory() ? 'D' : stat.isFile() ? 'F' : 'O';
      manifest.push([
        type,
        relative,
        stat.size,
        Math.trunc(stat.mtimeMs),
        Math.trunc(stat.ctimeMs),
      ].join(':'));

      if (stat.isSymbolicLink() || stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
        return;
      }
      if (!stat.isDirectory()) return;
      directoryCount += 1;
      const entries = (await fs.readdir(current)).sort((a, b) => a.localeCompare(b));
      for (const entry of entries) {
        await walk(path.join(current, entry));
      }
    };

    const exists = fsSync.existsSync(root);
    if (exists) await walk(root);
    const raw = [
      target.id,
      root,
      exists ? '1' : '0',
      ...manifest.sort((a, b) => a.localeCompare(b)),
    ].join('\0');
    const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
    return { exists, fileCount, directoryCount, totalBytes, fingerprint };
  }

  public checkPermission(action: 'read' | 'write' | 'command' | 'skills' | 'handoff', customCwd?: string, projectName?: string, sessionId: string = 'global'): {
    allowed: boolean;
    reason?: string;
    project?: ProjectInfo;
  } {
    let project: ProjectInfo | null = null;
    if (projectName && typeof projectName === 'string' && projectName.trim()) {
      project = Array.from(this.projects.values()).find(
        (p) => (p.id && p.id.toLowerCase() === projectName.toLowerCase()) || (p.name && p.name.toLowerCase() === projectName.toLowerCase())
      ) || null;
    }

    if (!project && projectName) {
      return {
        allowed: false,
        reason: `[PROJECT_REQUIRED] Project '${projectName}' was not found.`,
      };
    }

    if (!project) {
      return {
        allowed: false,
        reason: `[PROJECT_REQUIRED] Every project-scoped operation must specify a project.`,
      };
    }

    if (action === 'read' && !project.permissions.canRead) {
      return {
        allowed: false,
        reason: `[PERMISSION DENIED] User has restricted Read access on project "${project.name}".`,
        project,
      };
    }
    if (action === 'write' && !project.permissions.canWrite) {
      return {
        allowed: false,
        reason: `[PERMISSION DENIED] User has restricted Write/Modify access on project "${project.name}" (Read-Only Mode).`,
        project,
      };
    }
    if (action === 'command' && !project.permissions.canRunCommand) {
      return {
        allowed: false,
        reason: `[PERMISSION DENIED] User has disabled Terminal Command Execution on project "${project.name}".`,
        project,
      };
    }
    if (action === 'skills' && project.permissions.canUseSkills === false) {
      return {
        allowed: false,
        reason: `[PERMISSION DENIED] User has disabled Skills usage on project "${project.name}".`,
        project,
      };
    }
    if (action === 'handoff' && project.permissions.canUseHandoff === false) {
      return {
        allowed: false,
        reason: `[PERMISSION DENIED] User has disabled Session Handoff & Memory Compaction on project "${project.name}".`,
        project,
      };
    }
    return { allowed: true, project };
  }

  public sanitizeProjectForClient(p: ProjectInfo): ProjectInfo {
    if (!p) return p;
    let cleanDesc = p.description || `Project workspace for ${p.name}`;
    if (p.path) {
      const escaped = p.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleanDesc = cleanDesc.replace(new RegExp(escaped, 'g'), '.');
    }
    cleanDesc = cleanDesc.replace(/(\/Users\/[^\s]+|[a-zA-Z]:\\[^\s]+)/g, '.');

    const copy: ProjectInfo = {
      ...p,
      path: '.',
      description: cleanDesc,
    };

    // Strip heavy payload properties to keep client response lightweight (< 1KB)
    delete copy.systemPrompt;
    delete copy.projectInstructions;
    delete copy.availableSkills;

    // Provide lightweight indicators instead
    if (p.projectInstructions?.file) {
      (copy as any).instructionFile = p.projectInstructions.file;
    }
    if (p.availableSkills && Array.isArray(p.availableSkills)) {
      (copy as any).skills = p.availableSkills.map((s) => s.name);
    }

    return copy;
  }

  public ensureWithinProject(
    targetPath: string,
    customCwd?: string,
    projectName?: string,
    sessionId: string = 'global'
  ): { resolvedPath: string; relativePath: string; project: ProjectInfo } {
    let project: ProjectInfo | null = null;
    if (projectName && typeof projectName === 'string' && projectName.trim()) {
      project = Array.from(this.projects.values()).find(
        (p) => (p.id && p.id.toLowerCase() === projectName.toLowerCase()) || (p.name && p.name.toLowerCase() === projectName.toLowerCase())
      ) || null;
    }

    if (!project) {
      throw new Error(
        `[PROJECT_REQUIRED] Every project-scoped operation must specify a project.`
      );
    }

    const rootDir = path.resolve(project.path);
    let resolved: string;

    if (path.isAbsolute(targetPath)) {
      resolved = path.resolve(targetPath);
    } else if (customCwd) {
      const customRoot = path.isAbsolute(customCwd) ? path.resolve(customCwd) : path.resolve(rootDir, customCwd);
      resolved = path.resolve(customRoot, targetPath);
    } else {
      resolved = path.resolve(rootDir, targetPath);
    }

    const relative = path.relative(rootDir, resolved);
    const isEscaping = relative.startsWith('..') || path.isAbsolute(relative);

    if (isEscaping && !resolved.toLowerCase().startsWith(rootDir.toLowerCase())) {
      throw new Error(
        `[SECURITY JAIL] Access denied: Target path escapes the active project workspace "${project.name}". Please switch project first if you wish to work on another workspace.`
      );
    }

    return {
      resolvedPath: resolved,
      relativePath: relative || '.',
      project,
    };
  }

  public getProject(idOrName: string): ProjectInfo | null {
    if (!idOrName || typeof idOrName !== 'string') return null;
    const key = idOrName.toLowerCase().trim();
    for (const p of this.projects.values()) {
      if ((p.id && p.id.toLowerCase() === key) || (p.name && p.name.toLowerCase() === key)) {
        return p;
      }
    }
    return null;
  }

  public resolveSafePath(
    targetPath: string,
    customCwd?: string,
    projectName?: string,
    sessionId: string = 'global'
  ): string | null {
    try {
      const { resolvedPath } = this.ensureWithinProject(targetPath, customCwd, projectName, sessionId);
      return resolvedPath;
    } catch {
      return null;
    }
  }

  public resolveWorkingDir(customCwd?: string, projectName?: string, sessionId: string = 'global'): string {
    const { resolvedPath } = this.ensureWithinProject('.', customCwd, projectName, sessionId);
    return resolvedPath;
  }
}
