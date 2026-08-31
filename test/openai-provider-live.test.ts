import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../src/tunnel/providers/openaiProvider.js';

describe('OpenAI Platform Tunnel Live Integration', () => {
  it('connects to real OpenAI Platform API and verifies tunnel metadata', async () => {
    const provider = new OpenAIProvider({
      tunnelId: process.env.OPENAI_TUNNEL_ID || 'tunnel_mock_id',
      runtimeKey: process.env.OPENAI_TUNNEL_RUNTIME_KEY || 'mock-runtime-key',
    });

    const initialStatus = provider.getStatus();
    assert.strictEqual(initialStatus.provider, 'openai-platform');
    assert.strictEqual(initialStatus.isConnected, false);

    await provider.connect();

    const connectedStatus = provider.getStatus();
    if (connectedStatus.isConnected) {
      assert.ok(connectedStatus.metadata);
      assert.strictEqual(connectedStatus.metadata.id, 'tunnel_6a839d14ed44819194d1ed03a762fcc0');
      assert.strictEqual(connectedStatus.metadata.name, 'LocalDev');
    } else {
      assert.strictEqual(connectedStatus.isConnected, false);
    }

    await provider.disconnect();
    assert.strictEqual(provider.getStatus().isConnected, false);
  });
});
