import { randomUUID } from 'node:crypto';

export type DeliveryRecordMode = 'full' | 'diff' | 'reference';
export type DeliveryStatusValue =
  | 'never_delivered'
  | 'delivered_unconfirmed'
  | 'delivered_hash_confirmed'
  | 'content_changed'
  | 'unknown';
export type RecommendedDelivery = 'full' | 'diff' | 'unchanged' | 'unknown';

export interface ContextLedgerOptions {
  maxEntries?: number;
  maxContentBytes?: number;
  ttlMs?: number;
  now?: () => number;
  idFactory?: () => string;
}

export interface DeliveryRecord {
  deliveryId: string;
  scope: string;
  projectId: string;
  key: string;
  sha256: string;
  mode: DeliveryRecordMode;
  baseSha256?: string;
  operationId?: string;
  serverEmittedAt: number;
  hashConfirmedAt?: number;
  expiresAt: number;
}

export interface DeliveryStatusResult {
  status: DeliveryStatusValue;
  currentSha256: string;
  lastDeliveredSha256?: string;
  lastDelivery?: {
    deliveryId: string;
    mode: DeliveryRecordMode;
    serverEmittedAt: number;
  };
  evidence: {
    serverEmitted: boolean;
    hashConfirmed: boolean;
    modelConsumed: 'not_observable';
  };
  resendRequired: boolean | null;
  recommendedDelivery: RecommendedDelivery;
}

interface ContentCacheEntry {
  scope: string;
  key: string;
  sha256: string;
  content: string;
  bytes: number;
  storedAt: number;
  expiresAt: number;
}

interface ScopeMarker {
  state: 'active' | 'expired';
  touchedAt: number;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class ContextLedger {
  private readonly records = new Map<string, DeliveryRecord>();
  private readonly contentCache = new Map<string, ContentCacheEntry>();
  private readonly scopeMarkers = new Map<string, ScopeMarker>();
  private readonly maxEntries: number;
  private readonly maxContentBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private contentBytes = 0;

  constructor(options: ContextLedgerOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxContentBytes = Math.max(0, options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES);
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS);
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private id(scope: string, key: string, sha256: string): string {
    return `${scope}\u0000${key}\u0000${sha256}`;
  }

  private markScopeActive(scope: string, now = this.now()): void {
    this.scopeMarkers.set(scope, {
      state: 'active',
      touchedAt: now,
      expiresAt: now + this.ttlMs,
    });
  }

  private markScopeExpired(scope: string, now = this.now()): void {
    this.scopeMarkers.set(scope, {
      state: 'expired',
      touchedAt: now,
      expiresAt: now + this.ttlMs,
    });
  }

  private removeContent(id: string): void {
    const entry = this.contentCache.get(id);
    if (!entry) return;
    this.contentBytes = Math.max(0, this.contentBytes - entry.bytes);
    this.contentCache.delete(id);
  }

  private evictExpired(now = this.now()): void {
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(id);
        this.markScopeExpired(record.scope, now);
      }
    }

    for (const [id, entry] of this.contentCache) {
      if (entry.expiresAt <= now) this.removeContent(id);
    }

    for (const [scope, marker] of this.scopeMarkers) {
      if (marker.expiresAt > now) continue;
      if (marker.state === 'active') {
        this.markScopeExpired(scope, now);
      } else {
        this.scopeMarkers.delete(scope);
      }
    }
  }

  private enforceRecordLimit(now = this.now()): void {
    while (this.records.size > this.maxEntries) {
      let oldestId: string | undefined;
      let oldest: DeliveryRecord | undefined;
      for (const [id, record] of this.records) {
        if (!oldest || record.serverEmittedAt < oldest.serverEmittedAt) {
          oldestId = id;
          oldest = record;
        }
      }
      if (!oldestId || !oldest) break;
      this.records.delete(oldestId);
      this.markScopeExpired(oldest.scope, now);
    }
  }

  private enforceContentLimits(): void {
    while (this.contentCache.size > this.maxEntries || this.contentBytes > this.maxContentBytes) {
      let oldestId: string | undefined;
      let oldest: ContentCacheEntry | undefined;
      for (const [id, entry] of this.contentCache) {
        if (!oldest || entry.storedAt < oldest.storedAt) {
          oldestId = id;
          oldest = entry;
        }
      }
      if (!oldestId) break;
      this.removeContent(oldestId);
    }
  }

  private recordsFor(scope: string, key: string): DeliveryRecord[] {
    return [...this.records.values()]
      .filter((record) => record.scope === scope && record.key === key)
      .sort((a, b) => b.serverEmittedAt - a.serverEmittedAt);
  }

  public createDeliveryId(): string {
    const raw = this.idFactory();
    return raw.startsWith('del_') ? raw : `del_${raw}`;
  }

  public createRecord(options: {
    deliveryId: string;
    scope: string;
    projectId: string;
    key: string;
    sha256: string;
    mode: DeliveryRecordMode;
    baseSha256?: string;
    operationId?: string;
  }): DeliveryRecord {
    const now = this.now();
    return {
      ...options,
      serverEmittedAt: now,
      expiresAt: now + this.ttlMs,
    };
  }

  public get(scope: string, key: string, sha256: string): DeliveryRecord | undefined {
    this.evictExpired();
    return this.records.get(this.id(scope, key, sha256));
  }

  public has(scope: string, key: string, sha256: string): boolean {
    return Boolean(this.get(scope, key, sha256));
  }

  public getContent(scope: string, key: string, sha256: string): string | undefined {
    this.evictExpired();
    return this.contentCache.get(this.id(scope, key, sha256))?.content;
  }

  public commit(record: DeliveryRecord, content: string): void {
    const now = this.now();
    this.evictExpired(now);

    const normalized: DeliveryRecord = {
      ...record,
      serverEmittedAt: record.serverEmittedAt || now,
      expiresAt: record.expiresAt > now ? record.expiresAt : now + this.ttlMs,
    };
    const id = this.id(normalized.scope, normalized.key, normalized.sha256);
    this.records.set(id, normalized);
    this.markScopeActive(normalized.scope, now);

    const bytes = Buffer.byteLength(content, 'utf8');
    const previous = this.contentCache.get(id);
    if (previous) this.contentBytes = Math.max(0, this.contentBytes - previous.bytes);
    const cacheEntry: ContentCacheEntry = {
      scope: normalized.scope,
      key: normalized.key,
      sha256: normalized.sha256,
      content,
      bytes,
      storedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.contentCache.set(id, cacheEntry);
    this.contentBytes += bytes;

    this.enforceRecordLimit(now);
    this.enforceContentLimits();
  }

  public confirmHash(scope: string, key: string, sha256: string): boolean {
    const now = this.now();
    this.evictExpired(now);
    const id = this.id(scope, key, sha256);
    const record = this.records.get(id);
    if (!record) return false;

    record.hashConfirmedAt = now;
    record.expiresAt = now + this.ttlMs;
    this.records.set(id, record);
    const cached = this.contentCache.get(id);
    if (cached) {
      cached.expiresAt = now + this.ttlMs;
      cached.storedAt = now;
      this.contentCache.set(id, cached);
    }
    this.markScopeActive(scope, now);
    return true;
  }

  public getStatus(scope: string, key: string, currentSha256: string): DeliveryStatusResult {
    const now = this.now();
    this.evictExpired(now);
    const resourceRecords = this.recordsFor(scope, key);
    const currentRecord = resourceRecords.find((record) => record.sha256 === currentSha256);

    if (currentRecord) {
      const confirmed = currentRecord.hashConfirmedAt !== undefined;
      return {
        status: confirmed ? 'delivered_hash_confirmed' : 'delivered_unconfirmed',
        currentSha256,
        lastDeliveredSha256: currentRecord.sha256,
        lastDelivery: {
          deliveryId: currentRecord.deliveryId,
          mode: currentRecord.mode,
          serverEmittedAt: currentRecord.serverEmittedAt,
        },
        evidence: {
          serverEmitted: true,
          hashConfirmed: confirmed,
          modelConsumed: 'not_observable',
        },
        resendRequired: false,
        recommendedDelivery: 'unchanged',
      };
    }

    const lastRecord = resourceRecords[0];
    if (lastRecord) {
      return {
        status: 'content_changed',
        currentSha256,
        lastDeliveredSha256: lastRecord.sha256,
        lastDelivery: {
          deliveryId: lastRecord.deliveryId,
          mode: lastRecord.mode,
          serverEmittedAt: lastRecord.serverEmittedAt,
        },
        evidence: {
          serverEmitted: true,
          hashConfirmed: lastRecord.hashConfirmedAt !== undefined,
          modelConsumed: 'not_observable',
        },
        resendRequired: true,
        recommendedDelivery: this.getContent(scope, key, lastRecord.sha256) !== undefined ? 'diff' : 'full',
      };
    }

    const marker = this.scopeMarkers.get(scope);
    if (marker?.state === 'expired') {
      return {
        status: 'unknown',
        currentSha256,
        evidence: {
          serverEmitted: false,
          hashConfirmed: false,
          modelConsumed: 'not_observable',
        },
        resendRequired: null,
        recommendedDelivery: 'unknown',
      };
    }

    this.markScopeActive(scope, now);
    return {
      status: 'never_delivered',
      currentSha256,
      evidence: {
        serverEmitted: false,
        hashConfirmed: false,
        modelConsumed: 'not_observable',
      },
      resendRequired: true,
      recommendedDelivery: 'full',
    };
  }

  public clearScope(scope: string): void {
    for (const [id, record] of this.records) {
      if (record.scope === scope) this.records.delete(id);
    }
    for (const [id, entry] of this.contentCache) {
      if (entry.scope === scope) this.removeContent(id);
    }
    this.scopeMarkers.delete(scope);
  }
}
