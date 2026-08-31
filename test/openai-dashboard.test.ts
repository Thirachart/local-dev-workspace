import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderDashboardHtml } from '../src/ui/dashboard.js';

describe('OpenAI Tunnel dashboard contract', () => {
  it('uses the rendered status pill for refresh and a dedicated process state for toggling', () => {
    const html = renderDashboardHtml();
    const statusId = 'openai-tunnel-status-pill';

    assert.ok(html.includes(`id="${statusId}"`), 'OpenAI Tunnel status pill should be rendered');
    assert.strictEqual(
      (html.match(new RegExp(`getElementById\\('${statusId}'\\)`, 'g')) ?? []).length,
      1,
      'status refresh should target the rendered status pill once'
    );
    assert.ok(html.includes('openAiTunnelProcessRunning = processRunning'));
    assert.ok(html.includes('const isRunning = openAiTunnelProcessRunning'));
    assert.ok(!html.includes("getElementById('openai-tunnel-status-badge')"), 'stale status badge id must not remain');
  });

  it('renders profile management without exposing a runtime key', () => {
    const html = renderDashboardHtml();
    for (const id of [
      'select-openai-tunnel-profile',
      'openai-profile-name-input',
      'openai-profile-tunnel-id-input',
      'openai-profile-runtime-key-input',
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing OpenAI profile control ${id}`);
    }
    assert.ok(html.includes('/api/ui/tunnel/openai/profiles'));
    assert.ok(html.includes('/api/ui/tunnel/openai/profiles/active'));
    assert.ok(html.includes('/api/ui/tunnel/openai/start'));
    assert.ok(html.includes('/api/ui/tunnel/openai/stop'));
    assert.ok(html.includes('/api/ui/tunnel/openai/config'));
    assert.ok(html.includes('Runtime Key (leave blank to keep)'));
    assert.ok(!html.includes('keyInput.value = status.runtimeKey'));
    assert.ok(html.includes('JSON.stringify(isRunning ? {} : { profileId: activeOpenAiProfileId })'));
  });
});
