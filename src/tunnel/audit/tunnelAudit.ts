export interface TunnelAuditEvent {
  id: string;
  timestamp: number;
  provider: string;
  sessionId?: string;
  workspaceId?: string;
  action: string;
  tool?: string;
  success: boolean;
  durationMs?: number;
  clientIp?: string;
  errorCode?: string;
}

export class MemoryRingAuditLogger {
  private buffer: TunnelAuditEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  public log(event: Omit<TunnelAuditEvent, 'id' | 'timestamp'>): TunnelAuditEvent {
    const fullEvent: TunnelAuditEvent = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...event,
    };

    this.buffer.push(fullEvent);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift(); // Remove oldest item (Ring Buffer)
    }

    return fullEvent;
  }

  public listRecent(limit = 100): TunnelAuditEvent[] {
    return [...this.buffer].reverse().slice(0, limit);
  }

  public get size(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
  }
}
