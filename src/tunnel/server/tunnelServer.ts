import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { TunnelConnectionManager } from './connectionManager.js';
import { StreamTransportManager } from '../transport/streamTransport.js';
import { WebSocketTransportAdapter } from '../transport/websocketTransport.js';
import { TunnelSessionStore } from '../session/sessionStore.js';
import { TunnelSessionLifecycle } from '../session/sessionLifecycle.js';
import { ReplayGuard } from '../auth/replayGuard.js';
import { CapabilityResolver } from '../auth/capabilityResolver.js';
import { TunnelHandshakeEngine } from '../auth/handshake.js';
import { TunnelRouter, ToolExecutor } from './tunnelRouter.js';
import { MemoryRingAuditLogger } from '../audit/tunnelAudit.js';
import { TunnelBootstrapService } from '../auth/bootstrapService.js';
import { registerTunnelRoutes } from './routes.js';
import { createErrorFrame } from '../protocol/validation.js';
import type { AnyTunnelFrame } from '../protocol/protocol.js';

export interface TunnelServerOptions {
  port?: number;
  bootstrapService?: TunnelBootstrapService;
  toolExecutor?: ToolExecutor;
  auditLogger?: MemoryRingAuditLogger;
  defaultWorkspaceId?: string;
}

export class TunnelServerRuntime {
  public readonly port: number;
  private server: http.Server | null = null;
  private isListening = false;

  public readonly connectionManager: TunnelConnectionManager;
  public readonly streamTransport: StreamTransportManager;
  public readonly wsTransport: WebSocketTransportAdapter;
  public readonly sessionStore: TunnelSessionStore;
  public readonly sessionLifecycle: TunnelSessionLifecycle;
  public readonly replayGuard: ReplayGuard;
  public readonly capabilityResolver: CapabilityResolver;
  public readonly handshakeEngine: TunnelHandshakeEngine;
  public readonly bootstrapService: TunnelBootstrapService;
  public readonly auditLogger: MemoryRingAuditLogger;
  public readonly router: TunnelRouter;
  private readonly defaultWorkspaceId: string;

  constructor(options: TunnelServerOptions = {}) {
    this.port = typeof options.port === 'number' ? options.port : 4100;
    this.defaultWorkspaceId = options.defaultWorkspaceId || 'ws_default';
    this.connectionManager = new TunnelConnectionManager();
    this.streamTransport = new StreamTransportManager();
    this.wsTransport = new WebSocketTransportAdapter();
    this.sessionStore = new TunnelSessionStore();
    this.sessionLifecycle = new TunnelSessionLifecycle(this.sessionStore);
    this.replayGuard = new ReplayGuard();
    this.capabilityResolver = new CapabilityResolver();
    this.auditLogger = options.auditLogger || new MemoryRingAuditLogger();
    this.bootstrapService = options.bootstrapService || new TunnelBootstrapService();

    this.handshakeEngine = new TunnelHandshakeEngine(
      this.bootstrapService.getSecret(),
      this.replayGuard,
      this.sessionLifecycle
    );

    this.router = new TunnelRouter(
      this.sessionStore,
      this.capabilityResolver,
      this.auditLogger,
      options.toolExecutor
    );
  }

  public async start(): Promise<http.Server> {
    if (this.isListening && this.server) return this.server;

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    registerTunnelRoutes(app, this);

    this.server = http.createServer(app);
    this.wsTransport.attachToServer(this.server);
    this.connectionManager.startHeartbeatMonitoring();

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.isListening = true;
        resolve(this.server!);
      });
      this.server!.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    // The heartbeat interval is an independent event-loop resource and must
    // be stopped even when the HTTP server has already been closed.
    this.connectionManager.stopHeartbeatMonitoring();
    if (!this.server || !this.isListening) return;

    this.connectionManager.closeAll('Server stopped');

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) return reject(err);
        this.isListening = false;
        this.server = null;
        resolve();
      });
    });
  }

  public async handleIncomingFrame(frame: AnyTunnelFrame): Promise<any> {
    switch (frame.type) {
      case 'hello':
        return this.handshakeEngine.handleHello(frame);
      case 'authenticate':
        return this.handshakeEngine.handleAuthenticate(frame, this.defaultWorkspaceId);
      case 'request':
        return this.router.routeRequest(frame);
      case 'heartbeat': {
        const session = this.sessionLifecycle.heartbeat(frame.sessionId);
        return {
          type: 'response',
          protocolVersion: '2.0',
          id: `hb_resp_${Date.now()}`,
          timestamp: Date.now(),
          requestId: frame.id,
          success: true,
          result: { sessionId: session.sessionId, expiresAt: session.expiresAt },
        };
      }
      case 'disconnect': {
        if (frame.sessionId) {
          this.sessionLifecycle.revoke(frame.sessionId, frame.reason || 'Client disconnected');
        }
        return {
          type: 'response',
          protocolVersion: '2.0',
          id: `disc_resp_${Date.now()}`,
          timestamp: Date.now(),
          requestId: frame.id,
          success: true,
        };
      }
      default:
        return createErrorFrame('UNSUPPORTED_FRAME_TYPE', 'protocol', `Unsupported frame type '${(frame as any).type}'.`);
    }
  }
}
