import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type ActivitySource = 'mcp' | 'rest';
export type ActivityStatus = 'success' | 'error';

export interface PersistedActivityEvent {
  id?: number;
  timestamp: string;
  timestampMs: number;
  source: ActivitySource;
  action: string;
  project?: string;
  target?: string;
  category: string;
  params: Record<string, unknown>;
  status: ActivityStatus;
  durationMs: number;
  resultSummary?: string;
  error?: string;
}

export interface ActivityLogFilters {
  cursor?: number;
  limit?: number;
  action?: string;
  project?: string;
  status?: ActivityStatus;
  source?: ActivitySource;
  from?: number;
  to?: number;
}

export interface ActivityLogPage {
  events: PersistedActivityEvent[];
  nextCursor?: number;
  totalCount: number;
}

export class ActivityLogStore {
  private readonly db: Database.Database;
  public readonly databasePath: string;

  constructor(logDir: string) {
    fs.mkdirSync(logDir, { recursive: true });
    this.databasePath = path.join(logDir, 'activity.sqlite');
    this.db = new Database(this.databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const version = Number(this.db.pragma('user_version', { simple: true }));
    if (version >= 1) return;
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS activity_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp_ms INTEGER NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('mcp', 'rest')),
          action TEXT NOT NULL,
          project TEXT,
          target TEXT,
          category TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('success', 'error')),
          duration_ms INTEGER NOT NULL,
          params_json TEXT NOT NULL,
          result_summary TEXT,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON activity_events(timestamp_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_events_action_timestamp ON activity_events(action, timestamp_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_events_project_timestamp ON activity_events(project, timestamp_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_events_status_timestamp ON activity_events(status, timestamp_ms DESC);
      `);
      this.db.pragma('user_version = 1');
    })();
  }

  public append(event: PersistedActivityEvent): void {
    this.db.prepare(`
      INSERT INTO activity_events (
        timestamp_ms, source, action, project, target, category, status, duration_ms, params_json, result_summary, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.timestampMs, event.source, event.action, event.project || null, event.target || null, event.category, event.status, event.durationMs, JSON.stringify(event.params), event.resultSummary || null, event.error || null);
  }

  public query(filters: ActivityLogFilters = {}): ActivityLogPage {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filters.cursor) { where.push('id < ?'); values.push(filters.cursor); }
    if (filters.action) { where.push('action = ?'); values.push(filters.action); }
    if (filters.project) { where.push('project = ?'); values.push(filters.project); }
    if (filters.status) { where.push('status = ?'); values.push(filters.status); }
    if (filters.source) { where.push('source = ?'); values.push(filters.source); }
    if (filters.from) { where.push('timestamp_ms >= ?'); values.push(filters.from); }
    if (filters.to) { where.push('timestamp_ms <= ?'); values.push(filters.to); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(filters.limit || 100, 500));
    const totalCount = (this.db.prepare(`SELECT COUNT(*) AS count FROM activity_events ${clause}`).get(...values) as { count: number }).count;
    const rows = this.db.prepare(`SELECT * FROM activity_events ${clause} ORDER BY id DESC LIMIT ?`).all(...values, limit) as Array<Record<string, unknown>>;
    const events = rows.map((row) => ({
      id: Number(row.id),
      timestamp: new Date(Number(row.timestamp_ms)).toISOString().replace('T', ' ').substring(0, 19),
      timestampMs: Number(row.timestamp_ms),
      source: row.source as ActivitySource,
      action: String(row.action),
      project: row.project ? String(row.project) : undefined,
      target: row.target ? String(row.target) : undefined,
      category: String(row.category),
      status: row.status as ActivityStatus,
      durationMs: Number(row.duration_ms),
      params: JSON.parse(String(row.params_json)) as Record<string, unknown>,
      resultSummary: row.result_summary ? String(row.result_summary) : undefined,
      error: row.error ? String(row.error) : undefined,
    }));
    return { events, nextCursor: events.length === limit ? events.at(-1)?.id : undefined, totalCount };
  }

  public getStats(): { totalActions: number; errorCount: number } {
    return this.db.prepare(`SELECT COUNT(*) AS totalActions, COALESCE(SUM(status = 'error'), 0) AS errorCount FROM activity_events`).get() as { totalActions: number; errorCount: number };
  }

  public close(): void { this.db.close(); }
}
