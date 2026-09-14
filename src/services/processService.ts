import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { TaskInfo } from '../types/index.js';
import { ProjectService } from './projectService.js';

interface ActiveProcess {
  info: TaskInfo;
  process: ChildProcess;
  projectRoot: string;
  retentionTimer?: NodeJS.Timeout;
}

export interface CommandResult {
  taskId?: string;
  isDaemon: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status: string;
  durationMs: number;
  cwd: string;
  timedOut?: boolean;
  promotedToBackground?: boolean;
  processAlive?: boolean;
  terminationSucceeded?: boolean;
}

export interface DangerousPattern {
  pattern: RegExp;
  reason: string;
}

export class ProcessService {
  public static readonly DANGEROUS_COMMAND_PATTERNS: DangerousPattern[] = [
    // --- 1. ROOT & PRIVILEGE ESCALATION (UNIX & WINDOWS) ---
    { pattern: /\bsudo\b/i, reason: 'Root / Administrator privilege escalation (sudo) is blocked.' },
    { pattern: /\bsu(\s+.*)?$/i, reason: 'Switching to superuser (su) is blocked.' },
    { pattern: /\bdoas\b/i, reason: 'Privilege escalation (doas) is blocked.' },
    { pattern: /\bnet\s+(user|localgroup)\s+.*\/add\b/i, reason: 'Unauthorized user or administrator creation is blocked.' },
    { pattern: /\bSet-ExecutionPolicy\s+(Unrestricted|Bypass)\b/i, reason: 'Modifying PowerShell execution policy globally is blocked.' },

    // --- 2. DESTRUCTIVE FILE SYSTEM WIPING (CROSS-PLATFORM) ---
    { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\/\*|~\/\*|\.\.\/)/i, reason: 'Destructive deletion of root, home, or parent directory is blocked.' },
    { pattern: /\bchmod\s+(-R\s+)?(777|666)\s+(\/|~)/i, reason: 'Unrestricted global permission change on root or home is blocked.' },
    { pattern: /\b(rmdir|rd)\s+\/s\s+(\/q\s+)?([a-zA-Z]:\\|\\|\/)/i, reason: 'Windows root drive directory deletion (rmdir /s) is blocked.' },
    { pattern: /\bdel\s+(\/[fsq]\s+)+([a-zA-Z]:\\|\/)/i, reason: 'Windows root drive file deletion (del /s) is blocked.' },
    { pattern: /\bRemove-Item\s+.*(-Recurse|-Force).*(\$env:(USERPROFILE|SystemRoot|windir)|[a-zA-Z]:\\)/i, reason: 'PowerShell destructive system directory deletion is blocked.' },

    // --- 3. DISK FORMATTING & SYSTEM DAMAGE (UNIX & WINDOWS) ---
    { pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: 'Disk formatting (mkfs) is blocked.' },
    { pattern: /\bdd\s+if=/i, reason: 'Low-level direct disk write (dd) is blocked.' },
    { pattern: /\b(fdisk|parted|gdisk)\b/i, reason: 'Partition table modification is blocked.' },
    { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Windows drive formatting (format) is blocked.' },
    { pattern: /\b(diskpart|Clear-Disk|Initialize-Disk)\b/i, reason: 'Windows disk partitioning commands are blocked.' },

    // --- 4. SHUTDOWN & SYSTEM DISRUPTION (CROSS-PLATFORM) ---
    { pattern: /\b(shutdown|reboot|poweroff|halt|init\s+[06])\b/i, reason: 'System shutdown or restart command is blocked.' },
    { pattern: /\b(Stop-Computer|Restart-Computer)\b/i, reason: 'PowerShell system shutdown/restart is blocked.' },
    { pattern: /:(){ :|:& };:/, reason: 'Fork bomb attack is blocked.' },
    { pattern: /\btaskkill\s+(\/f\s+)?\/im\s+(lsass|csrss|services|smss|svchost)\.exe/i, reason: 'Killing critical OS system processes is blocked.' },

    // --- 5. REMOTE SCRIPT DOWNLOAD & REVERSE SHELLS ---
    { pattern: /\|\s*(bash|sh|zsh)\b/i, reason: 'Piping web download directly into shell interpreter is blocked.' },
    { pattern: /\b(IEX|Invoke-Expression)\s*\(?(New-Object|Invoke-WebRequest|iwr|curl|wget)/i, reason: 'PowerShell remote script download-and-execute is blocked.' },
    { pattern: /\b(nc|netcat|ncat)\s+.*(-e|-c|\/bin\/)/i, reason: 'Remote shell execution via netcat is blocked.' },
    { pattern: /\b(\/bin\/sh|\/bin\/bash)\s+-i\b/i, reason: 'Interactive shell redirection is blocked.' },

    // --- 6. SENSITIVE CREDENTIAL THEFT (CROSS-PLATFORM) ---
    { pattern: /\b(id_rsa|id_ed25519|id_ecdsa|id_dsa)\b/i, reason: 'Accessing private SSH keys is blocked.' },
    { pattern: /\b(\.aws\/credentials|\.azure\/|\.kube\/config)\b/i, reason: 'Accessing cloud/cluster credentials is blocked.' },
    { pattern: /\b(reg\s+save\s+hklm\\sam|mimikatz|Invoke-Mimikatz)\b/i, reason: 'Windows credential dumping is blocked.' },
  ];

  private projectService?: ProjectService;
  private baseDir: string;
  private tasks: Map<string, ActiveProcess> = new Map();

  constructor(baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  public validateCommandSafety(command: string): { isSafe: boolean; reason?: string } {
    if (!command || typeof command !== 'string') {
      return { isSafe: false, reason: 'Command is empty or invalid.' };
    }

    const trimmed = command.trim();
    for (const rule of ProcessService.DANGEROUS_COMMAND_PATTERNS) {
      if (rule.pattern.test(trimmed)) {
        return {
          isSafe: false,
          reason: rule.reason,
        };
      }
    }

    return { isSafe: true };
  }

  private resolveCwd(customCwd?: string, projectName?: string): { targetCwd: string; relCwd: string; projectRoot: string } {
    if (this.projectService) {
      const verified = this.projectService.ensureWithinProject(customCwd || '.', undefined, projectName);
      return {
        targetCwd: verified.resolvedPath,
        relCwd: verified.relativePath || '.',
        projectRoot: verified.project.path,
      };
    }
    const root = customCwd ? path.resolve(this.baseDir, customCwd) : this.baseDir;
    if (!root.startsWith(this.baseDir)) {
      throw new Error(`Security Violation: Execution working directory '${customCwd}' is outside project workspace.`);
    }
    return {
      targetCwd: root,
      relCwd: path.relative(this.baseDir, root) || '.',
      projectRoot: this.baseDir,
    };
  }

  private sanitizeOutput(text: string, projectRoot: string): string {
    if (!text || !projectRoot) return text;
    // Replace absolute project root with "." or relative reference
    const escaped = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'g'), '.');
  }

  private getShell(): { shell: string; args: string[] } {
    const isWindows = os.platform() === 'win32';
    if (isWindows) {
      return {
        shell: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'],
      };
    }
    return {
      shell: process.env.SHELL || '/bin/bash',
      args: ['-c'],
    };
  }

  public async runCommand(options: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    isDaemon?: boolean;
    detachOnTimeout?: boolean;
    projectName?: string;
  }): Promise<CommandResult> {
    // 🛡️ Step 0: Enforce Working Directory Jail & Project-level Command Execution Permission
    const { targetCwd, relCwd, projectRoot } = this.resolveCwd(options.cwd, options.projectName);
    if (this.projectService) {
      const verified = this.projectService.ensureWithinProject(options.cwd || '.', undefined, options.projectName);
      const activeProj = verified.project;
      if (activeProj?.permissions && activeProj.permissions.canRunCommand === false) {
        throw new Error(`[PERMISSION_DENIED] Terminal command execution is disabled for project "${activeProj.name}".`);
      }
      if (activeProj?.permissions?.blockedCommands && activeProj.permissions.blockedCommands.length > 0) {
        for (const blocked of activeProj.permissions.blockedCommands) {
          if (options.command.toLowerCase().includes(blocked.toLowerCase())) {
            throw new Error(`[PERMISSION_DENIED] Command contains blocked pattern "${blocked}" for project "${activeProj.name}".`);
          }
        }
      }
    }

    // 🛡️ Step 1: Validate Command Safety (Cross-Platform Security Guard)
    const safetyCheck = this.validateCommandSafety(options.command);
    if (!safetyCheck.isSafe) {
      throw new Error(`[SECURITY DENIED] Command blocked: ${safetyCheck.reason}`);
    }
    const { shell, args } = this.getShell();
    const startTime = Date.now();
    const taskId = `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const child = spawn(shell, [...args, options.command], {
      cwd: targetCwd,
      env: { ...process.env },
      windowsHide: true,
    });

    const taskInfo: TaskInfo = {
      id: taskId,
      command: options.command,
      cwd: relCwd, // Store relative cwd for security
      startTime,
      status: 'running',
      exitCode: null,
      outputBuffer: [],
      pid: child.pid,
    };

    const activeProc: ActiveProcess = {
      info: taskInfo,
      process: child,
      projectRoot,
    };

    this.tasks.set(taskId, activeProc);

    let stdoutData = '';
    let stderrData = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutData += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      taskInfo.outputBuffer.push(...lines);
      if (taskInfo.outputBuffer.length > 2000) {
        taskInfo.outputBuffer = taskInfo.outputBuffer.slice(-2000);
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderrData += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      taskInfo.outputBuffer.push(...lines);
      if (taskInfo.outputBuffer.length > 2000) {
        taskInfo.outputBuffer = taskInfo.outputBuffer.slice(-2000);
      }
    });

    child.on('close', (code) => {
      taskInfo.exitCode = code;
      if (taskInfo.status !== 'killed') {
        taskInfo.status = code === 0 ? 'completed' : 'failed';
      }
      taskInfo.endTime = taskInfo.endTime || Date.now();
      taskInfo.durationMs = taskInfo.durationMs ?? Math.max(0, taskInfo.endTime - taskInfo.startTime);

      // A timed-out foreground command is intentionally retained so the caller
      // can observe the promoted background process through task_status.
      if (options.isDaemon || (taskInfo.timedOut && options.detachOnTimeout)) {
        const retentionTimer = setTimeout(() => {
          const current = this.tasks.get(taskId);
          if (current?.info.status !== 'running') {
            this.tasks.delete(taskId);
          }
        }, 60 * 60 * 1000);
        retentionTimer.unref?.();
        activeProc.retentionTimer = retentionTimer;
      }
    });

    child.on('error', (err) => {
      taskInfo.status = 'failed';
      taskInfo.endTime = taskInfo.endTime || Date.now();
      taskInfo.durationMs = taskInfo.durationMs ?? Math.max(0, taskInfo.endTime - taskInfo.startTime);
      taskInfo.outputBuffer.push(`Process error: ${err.message}`);
    });

    if (options.isDaemon) {
      return {
        taskId,
        isDaemon: true,
        stdout: `Background daemon process started with Task ID: ${taskId}`,
        stderr: '',
        exitCode: null,
        status: 'running',
        durationMs: Date.now() - startTime,
        cwd: relCwd,
      };
    }

    const timeout = options.timeoutMs || 60000;

    return new Promise((resolve) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const result = {
          taskId,
          isDaemon: false,
          stdout: this.sanitizeOutput(stdoutData, projectRoot),
          stderr: this.sanitizeOutput(stderrData, projectRoot),
          exitCode: taskInfo.exitCode ?? null,
          status: taskInfo.status,
          durationMs: Date.now() - startTime,
          cwd: relCwd,
        };
        this.tasks.delete(taskId);
        resolve(result);
      };

      child.on('close', () => {
        finish();
      });

      timeoutHandle = setTimeout(() => {
        if (settled) return;
        taskInfo.timedOut = true;
        stderrData += `\n[Command timed out after ${timeout}ms]`;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (options.detachOnTimeout) {
          resolve({
            taskId,
            isDaemon: false,
            stdout: this.sanitizeOutput(stdoutData, projectRoot),
            stderr: this.sanitizeOutput(stderrData, projectRoot),
            exitCode: null,
            status: 'timed_out',
            durationMs: Date.now() - startTime,
            cwd: relCwd,
            timedOut: true,
            promotedToBackground: true,
            processAlive: child.exitCode === null && child.signalCode === null,
          });
          return;
        }

        void (async () => {
          const termination = await this.killTask(taskId, options.projectName);

          taskInfo.endTime = taskInfo.endTime || Date.now();
          taskInfo.durationMs = taskInfo.durationMs ?? Math.max(0, taskInfo.endTime - taskInfo.startTime);
          const processAlive = child.exitCode === null && child.signalCode === null;
          this.tasks.delete(taskId);
          resolve({
            taskId,
            isDaemon: false,
            stdout: this.sanitizeOutput(stdoutData, projectRoot),
            stderr: this.sanitizeOutput(stderrData, projectRoot),
            exitCode: child.exitCode,
            status: 'timed_out',
            durationMs: taskInfo.durationMs,
            cwd: relCwd,
            timedOut: true,
            promotedToBackground: false,
            processAlive,
            terminationSucceeded: termination.success && !processAlive,
          });
        })();
      }, timeout);
    });
  }

  private taskBelongsToProject(active: ActiveProcess, projectName?: string): boolean {
    if (!this.projectService) return true;
    const { projectRoot } = this.resolveCwd('.', projectName);
    return path.resolve(active.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase();
  }

  public getTaskStatus(
    taskId: string,
    maxLines: number = 100,
    projectName?: string
  ): {
    found: boolean;
    task?: {
      id: string;
      command: string;
      cwd: string;
      status: string;
      exitCode: number | null | undefined;
      runningTimeMs: number;
      durationMs: number;
      startedAt: string;
      finishedAt?: string;
      recentLogs: string[];
      pid?: number;
      timedOut?: boolean;
      processAlive?: boolean;
    };
  } {
    const active = this.tasks.get(taskId);
    if (!active || !this.taskBelongsToProject(active, projectName)) {
      return { found: false };
    }

    const info = active.info;
    const processAlive = active.process.exitCode === null && active.process.signalCode === null;
    const durationMs = info.durationMs ?? Math.max(0, (info.endTime || Date.now()) - info.startTime);
    const recentLogs = info.outputBuffer.slice(-maxLines).map(line => this.sanitizeOutput(line, active.projectRoot));

    return {
      found: true,
      task: {
        id: info.id,
        command: info.command,
        cwd: info.cwd,
        status: info.status,
        exitCode: info.exitCode,
        runningTimeMs: durationMs,
        durationMs,
        startedAt: new Date(info.startTime).toISOString(),
        finishedAt: info.endTime ? new Date(info.endTime).toISOString() : undefined,
        recentLogs,
        pid: info.pid,
        timedOut: info.timedOut,
        processAlive,
      },
    };
  }

  public listTasks(
    projectName?: string,
    options?: {
      status?: 'running' | 'completed' | 'failed' | 'killed';
      sinceMs?: number;
      limit?: number;
      sort?: 'newest' | 'oldest';
    }
  ): Array<{
    id: string;
    command: string;
    cwd: string;
    status: string;
    exitCode: number | null | undefined;
    runningTimeMs: number;
    durationMs: number;
    startedAt: string;
    finishedAt?: string;
    pid?: number;
    timedOut?: boolean;
    processAlive?: boolean;
  }> {
    const list = [];
    for (const [, active] of this.tasks) {
      if (!this.taskBelongsToProject(active, projectName)) continue;
      const info = active.info;
      if (options?.status && info.status !== options.status) continue;
      if (options?.sinceMs && info.startTime < options.sinceMs) continue;
      const durationMs = info.durationMs ?? Math.max(0, (info.endTime || Date.now()) - info.startTime);
      list.push({
        id: info.id,
        command: info.command,
        cwd: info.cwd,
        status: info.status,
        exitCode: info.exitCode,
        runningTimeMs: durationMs,
        durationMs,
        startedAt: new Date(info.startTime).toISOString(),
        finishedAt: info.endTime ? new Date(info.endTime).toISOString() : undefined,
        pid: info.pid,
        timedOut: info.timedOut,
        processAlive: active.process.exitCode === null && active.process.signalCode === null,
      });
    }
    list.sort((a, b) => {
      const delta = Date.parse(a.startedAt) - Date.parse(b.startedAt);
      return options?.sort === 'oldest' ? delta : -delta;
    });
    const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 500) : undefined;
    return limit ? list.slice(0, limit) : list;
  }

  private async waitForProcessExit(child: ChildProcess, timeoutMs = 5000): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('close', onClose);
        child.off('error', onError);
        resolve(exited);
      };
      const onClose = () => finish(true);
      const onError = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once('close', onClose);
      child.once('error', onError);
    });
  }

  public async killTask(taskId: string, projectName?: string): Promise<{ success: boolean; message: string }> {
    const active = this.tasks.get(taskId);
    if (!active || !this.taskBelongsToProject(active, projectName)) {
      return { success: false, message: `Task ${taskId} not found` };
    }

    const child = active.process;
    if (child.exitCode !== null || child.signalCode !== null) {
      return { success: true, message: `Task ${taskId} was already ${active.info.status}` };
    }

    if (active.info.status !== 'running' && !active.info.timedOut) {
      return { success: true, message: `Task ${taskId} was already ${active.info.status}` };
    }

    try {
      active.info.status = 'killed';
      active.info.endTime = Date.now();
      active.info.durationMs = Math.max(0, active.info.endTime - active.info.startTime);
      if (os.platform() === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        await new Promise<void>((resolve) => {
          killer.once('close', () => resolve());
          killer.once('error', () => resolve());
        });
      } else {
        child.kill('SIGTERM');
      }
      const exited = await this.waitForProcessExit(child);
      return exited
        ? { success: true, message: `Task ${taskId} terminated successfully` }
        : { success: false, message: `Task ${taskId} termination timed out; process may still be running` };
    } catch (err: any) {
      return { success: false, message: `Failed to terminate task ${taskId}: ${err.message}` };
    }
  }

  public async manageProcess(options: {
    action: 'start' | 'stop' | 'restart' | 'logs' | 'list';
    processId?: string;
    command?: string;
    cwd?: string;
    lines?: number;
    status?: 'all' | 'running' | 'completed' | 'failed' | 'killed';
    since?: string;
    limit?: number;
    sort?: 'newest' | 'oldest';
    projectName?: string;
  }): Promise<any> {
    if (options.action === 'list') {
      const sinceMs = options.since ? Date.parse(options.since) : undefined;
      if (options.since && !Number.isFinite(sinceMs)) {
        throw Object.assign(new Error('since must be a valid ISO-8601 timestamp.'), {
          code: 'INVALID_TIME_FILTER',
          category: 'validation',
        });
      }
      const processes = this.listTasks(options.projectName, {
        status: options.status && options.status !== 'all' ? options.status : undefined,
        sinceMs,
        limit: options.limit || 50,
        sort: options.sort || 'newest',
      });
      return {
        action: 'list',
        count: processes.length,
        limit: options.limit || 50,
        sort: options.sort || 'newest',
        processes,
      };
    }

    if (options.action === 'start') {
      if (!options.command) {
        throw new Error('Command is required to start a process.');
      }
      const res = await this.runCommand({
        command: options.command,
        cwd: options.cwd,
        isDaemon: true,
        projectName: options.projectName,
      });
      return {
        action: 'start',
        processId: res.taskId,
        command: options.command,
        status: res.status,
        message: `Process started in background (ID: ${res.taskId})`,
      };
    }

    if (options.action === 'stop') {
      if (!options.processId) {
        throw new Error('processId is required to stop a process.');
      }
      const killRes = await this.killTask(options.processId, options.projectName);
      return {
        action: 'stop',
        processId: options.processId,
        success: killRes.success,
        message: killRes.message,
      };
    }

    if (options.action === 'logs') {
      if (!options.processId) {
        throw new Error('processId is required to view process logs.');
      }
      const status = this.getTaskStatus(options.processId, options.lines || 50, options.projectName);
      if (!status.found || !status.task) {
        throw new Error(`Process with ID '${options.processId}' not found.`);
      }
      return {
        action: 'logs',
        processId: options.processId,
        status: status.task.status,
        runningTimeMs: status.task.runningTimeMs,
        durationMs: status.task.durationMs,
        startedAt: status.task.startedAt,
        finishedAt: status.task.finishedAt,
        logs: status.task.recentLogs,
      };
    }

    if (options.action === 'restart') {
      if (!options.processId && !options.command) {
        throw new Error('processId or command is required to restart a process.');
      }
      let cmdToRun = options.command;
      let cwdToRun = options.cwd;
      if (options.processId) {
        const oldStatus = this.getTaskStatus(options.processId, 100, options.projectName);
        if (oldStatus.found && oldStatus.task) {
          cmdToRun = cmdToRun || oldStatus.task.command;
          cwdToRun = cwdToRun || oldStatus.task.cwd;
          await this.killTask(options.processId, options.projectName);
        }
      }
      if (!cmdToRun) {
        throw new Error('Could not resolve command for restart.');
      }
      const res = await this.runCommand({
        command: cmdToRun,
        cwd: cwdToRun,
        isDaemon: true,
        projectName: options.projectName,
      });
      return {
        action: 'restart',
        newProcessId: res.taskId,
        command: cmdToRun,
        status: res.status,
        message: `Process restarted in background (New ID: ${res.taskId})`,
      };
    }

    throw new Error(`Invalid action: ${(options as any).action}`);
  }
}
