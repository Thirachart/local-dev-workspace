import type express from 'express';
import type { AnyTunnelFrame } from '../protocol/protocol.js';
import { serializeTunnelFrame } from '../protocol/validation.js';

export interface StreamClient {
  id: string;
  res: express.Response;
  closed: boolean;
}

export class StreamTransportManager {
  private clients = new Map<string, StreamClient>();

  public registerClient(id: string, res: express.Response): StreamClient {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const client: StreamClient = { id, res, closed: false };
    this.clients.set(id, client);

    res.on('close', () => {
      client.closed = true;
      this.clients.delete(id);
    });

    return client;
  }

  public sendFrame(id: string, frame: AnyTunnelFrame): boolean {
    const client = this.clients.get(id);
    if (!client || client.closed) return false;

    const payload = serializeTunnelFrame(frame);
    client.res.write(`data: ${payload}\n\n`);
    return true;
  }

  public broadcast(frame: AnyTunnelFrame): void {
    const payload = serializeTunnelFrame(frame);
    for (const client of this.clients.values()) {
      if (!client.closed) {
        client.res.write(`data: ${payload}\n\n`);
      }
    }
  }

  public closeClient(id: string): void {
    const client = this.clients.get(id);
    if (client && !client.closed) {
      client.closed = true;
      client.res.end();
      this.clients.delete(id);
    }
  }
}
