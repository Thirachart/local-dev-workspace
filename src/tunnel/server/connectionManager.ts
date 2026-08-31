import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { AnyTunnelFrame } from '../protocol/protocol.js';

export interface TunnelConnection {
  connectionId: string;
  sessionId?: string;
  workspaceId?: string;
  transportType: 'websocket' | 'stream' | 'http';
  connectedAt: number;
  lastPing: number;
  isAlive: boolean;
  metadata?: Record<string, unknown>;
  send: (frame: AnyTunnelFrame | string) => Promise<void>;
  close: (code?: number, reason?: string) => Promise<void>;
}

export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  activeSessions: number;
  totalFramesRouted: number;
  reconnectCount: number;
  uptimeSeconds: number;
}

export class TunnelConnectionManager extends EventEmitter {
  private connections = new Map<string, TunnelConnection>();
  private sessionToConnection = new Map<string, string>(); // sessionId -> connectionId
  private knownSessions = new Set<string>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private totalConnectionsCount = 0;
  private totalFramesCount = 0;
  private reconnectsCount = 0;

  constructor(private readonly pingIntervalMs = 30000, private readonly pingTimeoutMs = 10000) {
    super();
  }

  public startHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const conn of this.connections.values()) {
        if (!conn.isAlive && now - conn.lastPing > this.pingIntervalMs + this.pingTimeoutMs) {
          this.emit('connection_timeout', conn);
          conn.close(1000, 'Ping timeout').catch(() => {});
          this.removeConnection(conn.connectionId);
        } else {
          conn.isAlive = false;
        }
      }
    }, this.pingIntervalMs);
  }

  public stopHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public registerConnection(
    transportType: 'websocket' | 'stream' | 'http',
    sendFn: (frame: AnyTunnelFrame | string) => Promise<void>,
    closeFn: (code?: number, reason?: string) => Promise<void>,
    metadata?: Record<string, unknown>
  ): TunnelConnection {
    const connectionId = `conn_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    const connection: TunnelConnection = {
      connectionId,
      transportType,
      connectedAt: now,
      lastPing: now,
      isAlive: true,
      metadata,
      send: sendFn,
      close: closeFn,
    };

    this.connections.set(connectionId, connection);
    this.totalConnectionsCount++;
    this.emit('connection_registered', connection);
    return connection;
  }

  public bindSession(connectionId: string, sessionId: string, workspaceId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    // Check if this is a reconnect for an existing session
    if (this.knownSessions.has(sessionId)) {
      this.reconnectsCount++;
      this.emit('session_reconnected', { sessionId, oldConnId: this.sessionToConnection.get(sessionId), newConnId: connectionId });
    } else {
      this.knownSessions.add(sessionId);
    }

    conn.sessionId = sessionId;
    conn.workspaceId = workspaceId;
    this.sessionToConnection.set(sessionId, connectionId);
  }

  public recordPing(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.lastPing = Date.now();
      conn.isAlive = true;
    }
  }

  public recordFrame(): void {
    this.totalFramesCount++;
  }

  public removeConnection(connectionId: string): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;

    if (conn.sessionId) {
      this.sessionToConnection.delete(conn.sessionId);
    }

    this.connections.delete(connectionId);
    this.emit('connection_closed', conn);
    return true;
  }

  public getConnection(connectionId: string): TunnelConnection | undefined {
    return this.connections.get(connectionId);
  }

  public getConnectionBySession(sessionId: string): TunnelConnection | undefined {
    const connectionId = this.sessionToConnection.get(sessionId);
    if (!connectionId) return undefined;
    return this.connections.get(connectionId);
  }

  public getMetrics(): ConnectionMetrics {
    const now = Date.now();
    return {
      totalConnections: this.totalConnectionsCount,
      activeConnections: this.connections.size,
      activeSessions: this.sessionToConnection.size,
      totalFramesRouted: this.totalFramesCount,
      reconnectCount: this.reconnectsCount,
      uptimeSeconds: Math.floor((now - this.startedAt) / 1000),
    };
  }

  public closeAll(reason = 'Server shutdown'): void {
    for (const conn of this.connections.values()) {
      conn.close(1001, reason).catch(() => {});
    }
    this.connections.clear();
    this.sessionToConnection.clear();
    this.stopHeartbeatMonitoring();
  }
}
