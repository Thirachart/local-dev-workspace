import fsSync from 'node:fs';
import path from 'node:path';
import {
  ActivityLogFilters,
  ActivityLogPage,
  ActivityLogStore,
  ActivitySource,
  PersistedActivityEvent,
} from '../services/activityLogStore.js';

export interface ActivityLog extends Omit<PersistedActivityEvent, 'timestampMs' | 'category' | 'target'> {
  timestamp: string;
  source: ActivitySource;
  category?: ActivityCategory;
  target?: string;
}

export type ActivityCategory = 'read' | 'write' | 'build' | 'test' | 'git' | 'command' | 'idle';

export interface AgentStatusInfo {
  category: ActivityCategory;
  label: string;
  icon: string;
  target?: string;
  timestamp: number;
  isRecent: boolean;
  status: 'running' | 'success' | 'error';
  durationMs?: number;
}

export interface AgentStats {
  filesRead: number;
  filesWritten: number;
  buildsCount: number;
  testsCount: number;
  gitOpsCount: number;
  commandsCount: number;
  errorCount: number;
  totalActions: number;
}

export interface LoggerOptions {
  store?: Pick<ActivityLogStore, 'append' | 'query' | 'getStats' | 'close'>;
}

const SENSITIVE_KEY = /(?:api[_-]?key|authorization|token|secret|password|credential|runtime[_-]?key|content|patch|prompt|stdout|stderr|output|handoff|markdown|target_content|replacement_content)/i;
const MAX_STRING_LENGTH = 500;

function sanitizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/Expected Key:\s*"?[^"\s]+/gi, 'Expected Key: [REDACTED]')
    .replace(/chatdev_[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '[TRUNCATED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value).slice(0, MAX_STRING_LENGTH);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 30)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]));
}

export class Logger {
  private readonly store?: Pick<ActivityLogStore, 'append' | 'query' | 'getStats' | 'close'>;
  private recentLogs: ActivityLog[] = [];
  private lastActionTime = 0;
  private lastActionInfo: AgentStatusInfo | null = null;
  private stats: AgentStats = { filesRead: 0, filesWritten: 0, buildsCount: 0, testsCount: 0, gitOpsCount: 0, commandsCount: 0, errorCount: 0, totalActions: 0 };

  constructor(baseDir: string = process.cwd(), options: LoggerOptions = {}) {
    const logDir = path.resolve(baseDir, 'logs');
    if (!fsSync.existsSync(logDir)) fsSync.mkdirSync(logDir, { recursive: true });
    try {
      this.store = options.store || new ActivityLogStore(logDir);
    } catch (error) {
      console.error('[activity-log] SQLite unavailable; using in-memory log only:', error instanceof Error ? error.message : String(error));
    }
  }

  private categorizeAction(action: string, params: Record<string, unknown>): { category: ActivityCategory; label: string; icon: string; target?: string } {
    const act = action.toLowerCase();
    const rawTarget = params.path || params.file || params.targetPath || params.project || params.name || params.query || '';
    const target = typeof rawTarget === 'string' ? rawTarget.slice(0, 120) : undefined;
    if (act.includes('git_') || act.includes('push_branch')) return { category: 'git', label: 'Git & Deployment Operations', icon: '🌿', target };
    if (/(read_file|context_delivery_status|find_files|search_files|list_directory|read_project_instructions|read_handoff|get_project_snapshot|find_references|workspace_health)/.test(act)) return { category: 'read', label: 'Reading & Exploring Code', icon: '📖', target };
    if (/(write_file|edit_file|apply_patch|write_handoff|delete_file|move_file)/.test(act)) return { category: 'write', label: 'Writing & Modifying Code', icon: '✍️', target };
    if (/(run_tests|project_diagnostics)/.test(act)) return { category: 'test', label: 'Running Tests & Quality Checks', icon: '🧪', target };
    if (/build_diagnostics/.test(act)) return { category: 'build', label: 'Building & Compiling Project', icon: '⚙️', target };
    if (act.includes('list_projects') || act.includes('add_project') || act.includes('remove_project')) return { category: 'read', label: 'Workspace Project Registry', icon: '📁', target };
    return { category: 'command', label: `Executing ${action}`, icon: '🤖', target };
  }

  private static globalOnLogListeners: Array<(entry: ActivityLog, info: AgentStatusInfo) => void> = [];
  public static onLog(listener: (entry: ActivityLog, info: AgentStatusInfo) => void): void { Logger.globalOnLogListeners.push(listener); }
  public onLog(listener: (entry: ActivityLog, info: AgentStatusInfo) => void): void { Logger.globalOnLogListeners.push(listener); }

  public logAction(entry: Omit<ActivityLog, 'timestamp' | 'source'> & { source?: ActivitySource }): void {
    const timestampMs = Date.now();
    const timestamp = new Date(timestampMs).toISOString().replace('T', ' ').substring(0, 19);
    const params = sanitizeValue(entry.params || {}) as Record<string, unknown>;
    const categorized = this.categorizeAction(entry.action, params);
    const fullLog: ActivityLog = {
      timestamp,
      source: entry.source || 'rest',
      action: entry.action,
      params,
      status: entry.status,
      durationMs: entry.durationMs,
      resultSummary: sanitizeText(entry.resultSummary),
      error: sanitizeText(entry.error),
      category: categorized.category,
      target: categorized.target,
    };
    this.recentLogs.push(fullLog);
    if (this.recentLogs.length > 500) this.recentLogs = this.recentLogs.slice(-500);
    this.lastActionTime = timestampMs;
    this.lastActionInfo = { ...categorized, timestamp: timestampMs, isRecent: true, status: fullLog.status, durationMs: fullLog.durationMs };
    for (const listener of Logger.globalOnLogListeners) { try { listener(fullLog, this.lastActionInfo); } catch {} }
    this.stats.totalActions++;
    if (fullLog.status === 'error') this.stats.errorCount++;
    if (categorized.category === 'read') this.stats.filesRead++;
    if (categorized.category === 'write') this.stats.filesWritten++;
    if (categorized.category === 'build') this.stats.buildsCount++;
    if (categorized.category === 'test') this.stats.testsCount++;
    if (categorized.category === 'git') this.stats.gitOpsCount++;
    if (categorized.category === 'command') this.stats.commandsCount++;
    try {
      this.store?.append({ ...fullLog, timestampMs, source: fullLog.source, category: categorized.category, target: categorized.target });
    } catch (error) {
      console.error('[activity-log] Failed to persist event:', error instanceof Error ? error.message : String(error));
    }
    console.log(`[${timestamp}] ${fullLog.source.toUpperCase()} ${fullLog.action} (${fullLog.durationMs}ms) ${fullLog.status === 'success' ? '✅' : '❌'}`);
  }

  public queryActivityLogs(filters: ActivityLogFilters = {}): ActivityLogPage {
    try { return this.store?.query(filters) || this.queryMemory(filters); } catch { return this.queryMemory(filters); }
  }

  private queryMemory(filters: ActivityLogFilters): ActivityLogPage {
    const limit = Math.max(1, Math.min(filters.limit || 100, 500));
    const events = this.recentLogs.slice().reverse().filter((event) =>
      (!filters.action || event.action === filters.action) &&
      (!filters.project || event.params.project === filters.project) &&
      (!filters.status || event.status === filters.status) &&
      (!filters.source || event.source === filters.source)
    ).slice(0, limit);
    return { events: events.map((event) => ({ ...event, timestampMs: Date.parse(event.timestamp), category: event.category || 'command' })), totalCount: events.length };
  }

  public getRecentLogs(limit = 100): ActivityLog[] { return this.queryActivityLogs({ limit }).events as ActivityLog[]; }

  public getAgentStatus(): { currentStatus: AgentStatusInfo; stats: AgentStats } {
    const now = Date.now();
    const current = this.lastActionInfo && now - this.lastActionTime < 15_000
      ? { ...this.lastActionInfo, isRecent: true }
      : { category: 'idle' as const, label: 'Standby & Ready for AI Instructions', icon: '💤', target: 'Waiting for ChatGPT / AI agent requests...', timestamp: this.lastActionTime || now, isRecent: false, status: 'success' as const };
    return { currentStatus: current, stats: this.stats };
  }

  public close(): void { try { this.store?.close(); } catch {} }
}
