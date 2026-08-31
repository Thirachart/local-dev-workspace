import http from 'node:http';
import express from 'express';
import cors from 'cors';
import type { TunnelProvider, TunnelStatus } from './tunnelProvider.js';
import type { AnyTunnelFrame, ResponseFrame, ErrorFrame } from '../protocol/protocol.js';
import { parseTunnelFrame, serializeTunnelFrame, createErrorFrame } from '../protocol/validation.js';
import { TunnelHandshakeEngine } from '../auth/handshake.js';
import { TunnelRouter } from '../server/tunnelRouter.js';
import { TunnelSessionLifecycle } from '../session/sessionLifecycle.js';
import { TunnelSessionStore } from '../session/sessionStore.js';
import { ReplayGuard } from '../auth/replayGuard.js';
import { CapabilityResolver } from '../auth/capabilityResolver.js';
import { MemoryRingAuditLogger } from '../audit/tunnelAudit.js';

export interface SelfHostedProviderOptions {
  port: number;
  bootstrapSecret?: string;
  defaultWorkspaceId?: string;
  auditLogger?: MemoryRingAuditLogger;
}

export class SelfHostedProvider implements TunnelProvider {
  public readonly name = 'self-hosted';
  public readonly mode = 'inbound' as const;

  private server: http.Server | null = null;
  private isListening = false;
  private readonly port: number;
  private readonly startedAt = Date.now();

  public readonly sessionStore: TunnelSessionStore;
  public readonly sessionLifecycle: TunnelSessionLifecycle;
  public readonly replayGuard: ReplayGuard;
  public readonly capabilityResolver: CapabilityResolver;
  public readonly handshakeEngine: TunnelHandshakeEngine;
  public readonly auditLogger: MemoryRingAuditLogger;
  public readonly router: TunnelRouter;
  private readonly defaultWorkspaceId: string;

  constructor(options: SelfHostedProviderOptions) {
    this.port = options.port;
    this.defaultWorkspaceId = options.defaultWorkspaceId || 'ws_default';
    this.sessionStore = new TunnelSessionStore();
    this.sessionLifecycle = new TunnelSessionLifecycle(this.sessionStore);
    this.replayGuard = new ReplayGuard();
    this.capabilityResolver = new CapabilityResolver();
    this.auditLogger = options.auditLogger || new MemoryRingAuditLogger();
    this.handshakeEngine = new TunnelHandshakeEngine(
      options.bootstrapSecret || 'chatdev_bootstrap_secret',
      this.replayGuard,
      this.sessionLifecycle
    );
    this.router = new TunnelRouter(this.sessionStore, this.capabilityResolver, this.auditLogger);
  }

  public async connect(): Promise<void> {
    if (this.isListening) return;

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));

    // 1. Handshake & Message Endpoint
    app.post('/tunnel/message', async (req, res) => {
      try {
        const frame = parseTunnelFrame(req.body);
        const response = await this.send(frame);
        res.json(response);
      } catch (err: any) {
        const errFrame = createErrorFrame(err.code || 'BAD_REQUEST', err.category || 'validation', err.message);
        res.status(400).json(errFrame);
      }
    });

    // 2. Status Endpoint
    app.get('/tunnel/status', (_req, res) => {
      res.json(this.getStatus());
    });

    // 3. Audit Logs Endpoint (Local/Metadata Only)
    app.get('/tunnel/audit', (_req, res) => {
      res.json({ events: this.auditLogger.listRecent(50) });
    });

    return new Promise((resolve, reject) => {
      this.server = http.createServer(app);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.isListening = true;
        resolve();
      });
      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async disconnect(): Promise<void> {
    if (!this.server || !this.isListening) return;

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) return reject(err);
        this.isListening = false;
        this.server = null;
        resolve();
      });
    });
  }

  public async send(frame: AnyTunnelFrame): Promise<ResponseFrame | ErrorFrame | any> {
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

  public getStatus(): TunnelStatus {
    return {
      provider: this.name,
      mode: this.mode,
      isConnected: this.isListening,
      activeSessions: this.sessionStore.listActive().length,
      endpointUrl: `http://localhost:${this.port}/tunnel`,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
