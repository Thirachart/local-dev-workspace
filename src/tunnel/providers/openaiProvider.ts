import type { TunnelProvider, TunnelStatus } from './tunnelProvider.js';
import type { AnyTunnelFrame, ResponseFrame, ErrorFrame } from '../protocol/protocol.js';
import { createResponseFrame, createErrorFrame } from '../protocol/validation.js';
import { TunnelRouter } from '../server/tunnelRouter.js';

export interface OpenAIProviderOptions {
  tunnelId?: string;
  runtimeKey?: string;
  endpoint?: string;
  router?: TunnelRouter;
}

export interface OpenAITunnelMetadata {
  id: string;
  name?: string;
  description?: string;
  organization_ids?: string[];
  workspace_ids?: string[];
}

export class OpenAIProvider implements TunnelProvider {
  public readonly name = 'openai-platform';
  public readonly mode = 'outbound' as const;

  private connected = false;
  private metadata: OpenAITunnelMetadata | null = null;
  private readonly tunnelId: string;
  private readonly runtimeKey: string;
  private readonly endpoint: string;
  private readonly startedAt = Date.now();
  private readonly router?: TunnelRouter;

  constructor(options: OpenAIProviderOptions) {
    this.tunnelId = options.tunnelId || process.env.OPENAI_TUNNEL_ID || '';
    this.runtimeKey = options.runtimeKey || process.env.OPENAI_RUNTIME_KEY || '';
    this.endpoint = options.endpoint || 'https://api.openai.com/v1/tunnels';
    this.router = options.router;
  }

  public async connect(): Promise<void> {
    if (!this.tunnelId || !this.runtimeKey) {
      this.connected = false;
      return;
    }

    try {
      const url = `${this.endpoint.replace(/\/+$/, '')}/${this.tunnelId}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.runtimeKey}`,
          'OpenAI-Beta': 'tunnels=v1',
          'User-Agent': 'chat-dev-mcp/2.0.0',
        },
      });

      if (res.ok) {
        this.metadata = (await res.json()) as OpenAITunnelMetadata;
        this.connected = true;
      } else {
        const errorText = await res.text().catch(() => '');
        this.connected = false;
        console.warn(`[OpenAIProvider] Tunnel validation failed (HTTP ${res.status}): ${errorText}`);
      }
    } catch (err: any) {
      this.connected = false;
      console.warn(`[OpenAIProvider] Connection check error: ${err.message}`);
    }
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
  }

  public async send(frame: AnyTunnelFrame): Promise<ResponseFrame | ErrorFrame> {
    if (frame.type === 'request' && this.router) {
      return this.router.routeRequest(frame);
    }

    return createResponseFrame(frame.id, true, {
      provider: this.name,
      tunnelId: this.tunnelId,
      metadata: this.metadata,
      acknowledged: true,
    });
  }

  public getStatus(): TunnelStatus & { metadata?: OpenAITunnelMetadata | null } {
    return {
      provider: this.name,
      mode: this.mode,
      isConnected: this.connected,
      activeSessions: this.connected ? 1 : 0,
      tunnelId: this.tunnelId || undefined,
      endpointUrl: this.endpoint,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      metadata: this.metadata,
    };
  }
}
