import type express from 'express';
import { parseTunnelFrame, createErrorFrame } from '../protocol/validation.js';
import type { TunnelServerRuntime } from './tunnelServer.js';

export function isLocalRequest(req: express.Request): boolean {
  const host = (req.get('host') || '').toLowerCase();
  if (
    host.includes('.ngrok') ||
    host.includes('.ngrok-free.app') ||
    host.includes('.ngrok.io') ||
    host.includes('.trycloudflare.com') ||
    host.includes('cloudflare')
  ) {
    return false;
  }
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const ips = (Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : xForwardedFor)
      .split(',')
      .map((s) => s.trim());
    const hasExternalIp = ips.some(
      (ip) => ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1' && ip !== 'localhost'
    );
    if (hasExternalIp) {
      return false;
    }
  }
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocalIp =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost' ||
    ip.startsWith('127.');
  return (
    isLocalIp ||
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('0.0.0.0') ||
    host.startsWith('[::1]')
  );
}

export function registerTunnelRoutes(app: express.Express, runtime: TunnelServerRuntime): void {
  const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isLocalRequest(req)) {
      return next();
    }

    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const providedSecret = authHeader.slice(7).trim();
      if (runtime.bootstrapService.validateSecret(providedSecret)) {
        return next();
      }
    }

    const errFrame = createErrorFrame(
      'ADMIN_ACCESS_DENIED',
      'auth',
      'This tunnel endpoint is restricted to localhost or requires valid admin Bearer authentication.'
    );
    res.status(403).json(errFrame);
  };

  // 1. Single-Turn JSON Tunnel Message (Zero-Trust Handshake & Authenticated Request Frames)
  app.post('/tunnel/message', async (req, res) => {
    try {
      const frame = parseTunnelFrame(req.body);
      runtime.connectionManager.recordFrame();
      const response = await runtime.handleIncomingFrame(frame);
      res.json(response);
    } catch (err: any) {
      const errFrame = createErrorFrame(err.code || 'BAD_REQUEST', err.category || 'validation', err.message);
      res.status(400).json(errFrame);
    }
  });

  // 2. Real-Time Streaming Channel (SSE / Stream)
  app.get('/tunnel/stream', (req, res) => {
    const clientId = (req.query.clientId as string) || `stream_${Date.now()}`;
    const streamClient = runtime.streamTransport.registerClient(clientId, res);

    const conn = runtime.connectionManager.registerConnection(
      'stream',
      async (frame) => {
        if (typeof frame === 'string') {
          streamClient.res.write(`data: ${frame}\n\n`);
        } else {
          runtime.streamTransport.sendFrame(clientId, frame);
        }
      },
      async () => {
        runtime.streamTransport.closeClient(clientId);
      }
    );

    req.on('close', () => {
      runtime.connectionManager.removeConnection(conn.connectionId);
    });
  });

  // 3. Status & Metrics Endpoint (Admin / Local Protected)
  app.get('/tunnel/status', requireAdminAuth, (_req, res) => {
    const metrics = runtime.connectionManager.getMetrics();
    res.json({
      status: 'online',
      port: runtime.port,
      activeSessions: runtime.sessionStore.listActive().length,
      metrics,
    });
  });

  // 4. Audit Log Endpoint (Admin / Local Protected)
  app.get('/tunnel/audit', requireAdminAuth, (_req, res) => {
    res.json({ events: runtime.auditLogger.listRecent(50) });
  });

  // 5. Bootstrap Secret Rotation (Admin / Local Protected)
  app.post('/tunnel/rotate-secret', requireAdminAuth, (_req, res) => {
    const newSecret = runtime.bootstrapService.rotateSecret();
    res.json({ success: true, bootstrapSecret: newSecret });
  });
}
