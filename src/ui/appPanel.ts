export function renderAppPanelHtml(port: number, hostname: string = 'localhost'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Dev Tool MCP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #f1f5f9;
      --bg-card: #ffffff;
      --bg-subtle: #f8fafc;
      --border-color: rgba(226, 232, 240, 0.9);
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-dim: #94a3b8;
      --accent-purple: #6366f1;
      --accent-purple-hover: #4f46e5;
      --accent-purple-light: #eef2ff;
      --accent-green: #10b981;
      --accent-green-light: #ecfdf5;
      --accent-red: #ef4444;
      --accent-blue: #0284c7;
      --accent-amber: #d97706;
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 20px -2px rgba(15, 23, 42, 0.06);
      --shadow-lg: 0 10px 30px -4px rgba(99, 102, 241, 0.25);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
    }

    body {
      background-color: var(--bg-base);
      color: var(--text-main);
      display: flex;
      justify-content: center;
      padding: 20px 16px 28px;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    .app-container {
      width: 100%;
      max-width: 440px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* TOP HEADER */
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 2px 2px 6px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .app-logo-badge {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.3);
    }

    .header-titles h1 {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .header-titles .host-name {
      font-size: 16px;
      font-weight: 800;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 14px;
      border-radius: 24px;
      font-size: 12px;
      font-weight: 700;
      background: #ffffff;
      border: 1px solid var(--border-color);
      color: var(--text-main);
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--accent-green);
      transition: all 0.3s ease;
    }

    .status-dot.active {
      background-color: var(--accent-purple);
      box-shadow: 0 0 10px var(--accent-purple);
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.8; }
    }

    /* STATS ROW */
    .stats-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 10px 12px;
      box-shadow: var(--shadow-sm);
    }

    .stat-card-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: var(--text-dim);
      text-transform: uppercase;
      margin-bottom: 2px;
    }

    .stat-card-value {
      font-size: 13px;
      font-weight: 800;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stat-card-value.highlight {
      color: var(--accent-purple);
    }

    /* HERO CARD: PRIVATE OUTBOUND BRIDGE */
    .hero-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      padding: 24px 20px 22px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      box-shadow: var(--shadow-md);
      position: relative;
    }

    .hero-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 20px;
      background: var(--accent-purple-light);
      color: var(--accent-purple);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      margin-bottom: 16px;
    }

    /* ORBITAL RING GRAPHIC */
    .orbital-container {
      position: relative;
      width: 104px;
      height: 104px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .orbital-ring-outer {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 2px dashed rgba(99, 102, 241, 0.3);
      animation: spin 18s linear infinite;
    }

    .orbital-ring-middle {
      position: absolute;
      width: 82px;
      height: 82px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, rgba(255, 255, 255, 0) 70%);
      border: 1px solid rgba(99, 102, 241, 0.25);
    }

    .orbital-core {
      position: relative;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #ffffff;
      border: 2px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-purple);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
      transition: all 0.3s ease;
    }

    .orbital-core.active {
      border-color: var(--accent-green);
      color: var(--accent-green);
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .hero-status-title {
      font-size: 19px;
      font-weight: 800;
      color: var(--text-main);
      margin-bottom: 4px;
    }

    .hero-status-desc {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      line-height: 1.5;
      max-width: 320px;
      margin-bottom: 18px;
    }

    .btn-hero {
      width: 100%;
      max-width: 290px;
      padding: 12px 24px;
      border-radius: 28px;
      border: none;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #ffffff;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: var(--shadow-lg);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn-hero:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 34px -4px rgba(99, 102, 241, 0.4);
    }

    .btn-hero:active {
      transform: translateY(0);
    }

    .btn-hero.active-stop {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      box-shadow: 0 10px 30px -4px rgba(239, 68, 68, 0.35);
    }

    /* SECTION CARDS */
    .section-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 18px;
      padding: 16px 18px;
      box-shadow: var(--shadow-sm);
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .section-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-icon-badge {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-purple);
    }

    .section-titles .category {
      font-size: 10px;
      font-weight: 800;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .section-titles .title {
      font-size: 14px;
      font-weight: 800;
      color: var(--text-main);
    }

    /* BUTTONS GRID (3 CRITICAL ACTIONS) */
    .tools-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 8px;
    }

    .btn-tool {
      padding: 11px 14px;
      border-radius: 14px;
      background: #ffffff;
      border: 1px solid var(--border-color);
      color: var(--text-main);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-decoration: none;
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }

    .btn-tool:hover {
      background: var(--bg-subtle);
      border-color: var(--accent-purple);
      color: var(--accent-purple);
      transform: translateY(-1px);
    }

    .btn-tool.full-width {
      grid-column: span 2;
    }

    /* ALLOWED ROOTS */
    .roots-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .root-item {
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
    }

    .root-item .path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 8px;
    }

    .btn-add {
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
      color: var(--accent-purple);
      font-size: 12px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .btn-add:hover {
      background: var(--accent-purple-light);
    }

    svg {
      flex-shrink: 0;
    }
  </style>
</head>
<body>

  <div class="app-container">
    <!-- TOP HEADER -->
    <div class="header-bar">
      <div class="header-left">
        <div class="app-logo-badge">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <div class="header-titles">
          <h1>LOCAL DEV TOOL MCP</h1>
          <div class="host-name">${hostname}</div>
        </div>
      </div>
      <div class="header-right">
        <div class="status-pill" id="header-status-pill">
          <span class="status-dot" id="header-status-dot"></span>
          <span id="header-status-text">Standby & Ready</span>
        </div>
      </div>
    </div>

    <!-- 3 STATS CARDS -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-card-label">BRIDGE</div>
        <div class="stat-card-value highlight">Port ${port}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">OPENAI TUNNEL</div>
        <div class="stat-card-value" id="stat-tunnel-val">Port 8080</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">SECURITY</div>
        <div class="stat-card-value">Path Jail</div>
      </div>
    </div>

    <!-- HERO CARD: PRIVATE OUTBOUND BRIDGE -->
    <div class="hero-card">
      <div class="hero-tag">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span>PRIVATE OUTBOUND BRIDGE</span>
      </div>
      
      <div class="orbital-container">
        <div class="orbital-ring-outer"></div>
        <div class="orbital-ring-middle"></div>
        <div class="orbital-core" id="orbital-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
      </div>

      <div class="hero-status-title" id="hero-status-title">Disconnected</div>
      <div class="hero-status-desc" id="hero-status-desc">
        Ready to connect and expose allowed workspace roots to ChatGPT & AI Agents.
      </div>

      <button class="btn-hero" id="btn-hero-toggle" onclick="toggleHeroBridge()">
        <span id="btn-hero-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </span>
        <span id="btn-hero-text">Connect to OpenAI Bridge</span>
      </button>
    </div>

    <!-- SECTION: CONTROL & ESSENTIAL TOOLS -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <div class="section-icon-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div class="section-titles">
            <div class="category">CONTROL & TOOLS</div>
            <div class="title">Essential Actions & Controls</div>
          </div>
        </div>
      </div>

      <div class="tools-grid">
        <a href="/logs" target="_blank" class="btn-tool">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span>Web Dashboard (4100)</span>
        </a>
        <a href="http://127.0.0.1:8080/ui" target="_blank" class="btn-tool">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Tunnel UI (8080)</span>
        </a>
        <button onclick="restartServer()" class="btn-tool full-width">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span>Restart MCP Server Process</span>
        </button>
      </div>
    </div>

    <!-- SECTION: ALLOWED WORKSPACE ROOTS -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <div class="section-icon-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="section-titles">
            <div class="category">FILESYSTEM</div>
            <div class="title">Allowed Workspace Roots</div>
          </div>
        </div>
        <button class="btn-add" onclick="window.open('/logs', '_blank')" title="Manage Projects in Web Dashboard">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Add Project</span>
        </button>
      </div>

      <div class="roots-list" id="roots-list-container">
        <div class="root-item">
          <span class="path" id="default-root-path">Loading registered projects...</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
      </div>
    </div>
  </div>

  <script>
    let isTunnelRunning = false;

    async function pollStatus() {
      try {
        const [agentRes, tunnelRes, projectsRes] = await Promise.all([
          fetch('/api/ui/agent_status').then(r => r.json()).catch(() => null),
          fetch('/api/ui/tunnel/openai/status').then(r => r.json()).catch(() => null),
          fetch('/api/projects').then(r => r.json()).catch(() => null)
        ]);

        if (agentRes) {
          const action = agentRes.activeAction || 'idle';
          const isRecent = agentRes.currentStatus && agentRes.currentStatus.isRecent;
          const statusText = isRecent ? (agentRes.currentStatus.label || action) : 'Standby & Ready';
          
          document.getElementById('header-status-text').textContent = statusText;
          const dot = document.getElementById('header-status-dot');
          if (isRecent) {
            dot.classList.add('active');
          } else {
            dot.classList.remove('active');
          }
        }

        if (tunnelRes) {
          isTunnelRunning = !!tunnelRes.running;
          const title = document.getElementById('hero-status-title');
          const desc = document.getElementById('hero-status-desc');
          const btn = document.getElementById('btn-hero-toggle');
          const btnText = document.getElementById('btn-hero-text');
          const orbCore = document.getElementById('orbital-icon');
          const statTunnel = document.getElementById('stat-tunnel-val');

          if (isTunnelRunning) {
            title.textContent = 'Connected & Active';
            desc.textContent = 'Tunnel is securely exposing local MCP workspace on Port 8080.';
            btn.className = 'btn-hero active-stop';
            btnText.textContent = 'Disconnect OpenAI Bridge';
            orbCore.className = 'orbital-core active';
            orbCore.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
            statTunnel.textContent = 'Active (8080)';
          } else {
            title.textContent = 'Disconnected';
            desc.textContent = 'Ready to connect and expose allowed workspace roots to ChatGPT & AI Agents.';
            btn.className = 'btn-hero';
            btnText.textContent = 'Connect to OpenAI Bridge';
            orbCore.className = 'orbital-core';
            orbCore.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
            statTunnel.textContent = 'Stopped (8080)';
          }
        }

        if (projectsRes && Array.isArray(projectsRes.projects)) {
          const container = document.getElementById('roots-list-container');
          if (projectsRes.projects.length > 0) {
            container.innerHTML = projectsRes.projects.map(p => \`
              <div class="root-item">
                <span class="path" title="\${p.path}">\${p.path}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </div>
            \`).join('');
          }
        }
      } catch (err) {
        console.error('Failed to poll status:', err);
      }
    }

    async function toggleHeroBridge() {
      const endpoint = isTunnelRunning ? '/api/ui/tunnel/openai/stop' : '/api/ui/tunnel/openai/start';
      try {
        await fetch(endpoint, { method: 'POST' });
        await pollStatus();
      } catch (err) {
        alert('Bridge toggle error: ' + err.message);
      }
    }

    async function restartServer() {
      if (!confirm('Are you sure you want to restart the MCP server process?')) return;
      try {
        await fetch('/api/ui/restart', { method: 'POST' }).catch(() => null);
        alert('Server restarting... Window will reconnect automatically in a moment.');
        setTimeout(pollStatus, 1500);
      } catch (err) {
        console.error(err);
      }
    }

    setInterval(pollStatus, 1500);
    pollStatus();
  </script>
</body>
</html>`;
}
