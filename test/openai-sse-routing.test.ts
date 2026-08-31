import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  configureSseResponse,
  getOpenAiTunnelStartRequest,
  forwardSsePostMessage,
  isJsonRpcNotification,
  resolveOAuthDiscoveryConfig,
  shouldServeSse,
} from '../src/transports/sse.js';

describe('OpenAI Tunnel SSE routing', () => {
  it('normalizes the OpenAI tunnel start request', () => {
    assert.deepEqual(getOpenAiTunnelStartRequest({ profileId: ' work ' }), { profileId: 'work' });
    assert.deepEqual(getOpenAiTunnelStartRequest({ profileId: 42 }), {});
    assert.deepEqual(getOpenAiTunnelStartRequest(null), {});
  });

  it('exposes localhost-only OpenAI profile route contracts', () => {
    const source = fs.readFileSync(new URL('../src/transports/sse.ts', import.meta.url), 'utf8');
    for (const route of [
      '/api/ui/tunnel/openai/profiles',
      '/api/ui/tunnel/openai/profiles/:id',
      '/api/ui/tunnel/openai/profiles/active',
      '/api/ui/tunnel/openai/status',
      '/api/ui/tunnel/openai/config',
      '/api/ui/tunnel/openai/start',
      '/api/ui/tunnel/openai/stop',
    ]) {
      assert.ok(source.includes(route), `missing OpenAI route ${route}`);
    }
    assert.ok(source.includes('...getOpenAiTunnelStartRequest(req.body)'));
    assert.ok(source.includes("app.get('/api/ui/tunnel/openai/profiles', requireLocalAccess"));
    assert.ok(source.includes("app.post('/api/ui/tunnel/openai/profiles', requireLocalAccess"));
    assert.ok(source.includes("app.put('/api/ui/tunnel/openai/profiles/:id', requireLocalAccess"));
    assert.ok(source.includes("app.delete('/api/ui/tunnel/openai/profiles/:id', requireLocalAccess"));
    assert.ok(source.includes("app.post('/api/ui/tunnel/openai/profiles/active', requireLocalAccess"));
  });

  it('recognizes event-stream requests before serving the dashboard', () => {
    assert.equal(
      shouldServeSse({ headers: { accept: 'application/json, text/event-stream' }, query: {} }),
      true
    );
    assert.equal(shouldServeSse({ headers: { accept: 'text/html' }, query: {} }), false);
    assert.equal(shouldServeSse({ headers: {}, query: { transport: 'sse' } }), true);
  });

  it('does not flush headers before SSEServerTransport starts the response', () => {
    const headers: Record<string, string> = {};
    const response = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      flushHeaders() {
        throw new Error('flushHeaders must be owned by SSEServerTransport');
      },
    };

    configureSseResponse(response);

    assert.equal(headers['Content-Type'], 'text/event-stream');
    assert.equal(headers['Cache-Control'], 'no-cache');
    assert.equal(headers.Connection, 'keep-alive');
    assert.equal(headers['X-Accel-Buffering'], 'no');
  });

  it('recognizes JSON-RPC notifications that must not wait for a response', () => {
    assert.equal(isJsonRpcNotification({ jsonrpc: '2.0', method: 'notifications/initialized' }), true);
    assert.equal(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'initialize' }), false);
    assert.equal(isJsonRpcNotification({ jsonrpc: '2.0', id: 0, method: 'ping' }), false);
  });

  it('forwards the parsed JSON body to SSEServerTransport', async () => {
    const message = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
    let forwarded: unknown;
    const transport = {
      async handlePostMessage(_req: unknown, _res: unknown, parsedBody?: unknown) {
        forwarded = parsedBody;
      },
    };

    await forwardSsePostMessage(transport, { body: message }, {});

    assert.deepEqual(forwarded, message);
  });

  it('only enables OAuth discovery with an explicit HTTPS authorization origin', () => {
    assert.equal(resolveOAuthDiscoveryConfig({}), null);
    assert.equal(
      resolveOAuthDiscoveryConfig({ MCP_OAUTH_PUBLIC_BASE_URL: 'http://127.0.0.1:4100' }),
      null
    );
    assert.deepEqual(
      resolveOAuthDiscoveryConfig({ MCP_OAUTH_PUBLIC_BASE_URL: 'https://auth.example.test/' }),
      {
        resourceUrl: 'https://auth.example.test',
        authorizationServerUrl: 'https://auth.example.test',
      }
    );
    assert.deepEqual(
      resolveOAuthDiscoveryConfig({
        MCP_OAUTH_AUTHORIZATION_SERVER_URL: 'https://auth.example.test',
        MCP_OAUTH_RESOURCE_URL: 'https://mcp.example.test',
      }),
      {
        resourceUrl: 'https://mcp.example.test',
        authorizationServerUrl: 'https://auth.example.test',
      }
    );
    assert.equal(
      resolveOAuthDiscoveryConfig({
        MCP_OAUTH_PUBLIC_BASE_URL: 'https://auth.example.test',
        MCP_OAUTH_RESOURCE_URL: 'http://127.0.0.1:4100',
      }),
      null
    );
  });
});
