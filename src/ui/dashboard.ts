import { getProfileOpCounts } from '../transports/openapi.js';

export function renderDashboardHtml(port = 4100): string {
  const opCounts = getProfileOpCounts();
  return `<!DOCTYPE html>
<html lang="th" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Dev Workspace - Tool & Permission Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card: #131b2e;
      --card-hover: #18233c;
      --border: #1e293b;
      --border-focus: #38bdf8;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(19, 27, 46, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 40;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: -0.5px;
    }
    .brand-icon {
      width: 34px;
      height: 34px;
      background: linear-gradient(135deg, #38bdf8, #6366f1);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: var(--success);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
    }
    .dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
    }
    .container {
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 32px 24px;
      flex: 1;
    }
    .nav-tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 28px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    .active-banner {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(99, 102, 241, 0.08));
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 14px;
      padding: 24px;
      margin-bottom: 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .active-info h3 { font-size: 14px; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .active-info h2 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .active-info p { color: var(--text-muted); font-size: 14px; font-family: 'JetBrains Mono', monospace; }
    .perm-badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .perm-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .perm-allowed { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
    .perm-denied { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .section-header h2 { font-size: 20px; font-weight: 700; }
    .btn {
      background: var(--primary);
      color: #04101e;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-secondary {
      background: #1e293b;
      color: var(--text);
      border: 1px solid #334155;
    }
    .btn-secondary:hover { background: #334155; }
    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .btn-danger:hover { background: var(--danger); color: white; }
    .btn-sm { padding: 6px 12px; font-size: 12px; }

    .grid-projects {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
    }
    .project-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .project-card:hover { border-color: #334155; transform: translateY(-2px); }
    .project-card.is-active {
      border-color: var(--primary);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.12);
    }
    .card-top { margin-bottom: 16px; }
    .card-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .card-title h3 { font-size: 17px; font-weight: 700; }
    .card-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-muted);
      word-break: break-all;
      margin-bottom: 12px;
    }
    .card-desc { font-size: 13px; color: #94a3b8; margin-bottom: 14px; min-height: 38px; }
    .card-actions {
      border-top: 1px solid var(--border);
      padding-top: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 50;
      padding: 16px;
    }
    .modal {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 520px;
      width: 100%;
      padding: 28px;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .modal-header h3 { font-size: 18px; font-weight: 700; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    .form-control {
      width: 100%;
      background: #0b0f19;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }
    .form-control:focus { border-color: var(--border-focus); }
    .checkbox-group {
      background: #0b0f19;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 20px;
    }
    .checkbox-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .checkbox-item:last-child { margin-bottom: 0; }
    .checkbox-item input { margin-top: 3px; cursor: pointer; }
    .checkbox-item span { font-size: 13px; font-weight: 600; }
    .checkbox-item small { display: block; font-size: 12px; color: var(--text-muted); font-weight: normal; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
    th { text-align: left; padding: 12px 14px; background: #18233c; font-size: 13px; color: #cbd5e1; }
    td { padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    pre { font-family: 'JetBrains Mono', monospace; font-size: 12px; margin: 0; }

    .code-box {
      background: #070a12;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 14px;
      position: relative;
      margin-bottom: 20px;
    }
    .copy-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      background: #1e293b;
      color: #94a3b8;
      border: none;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .copy-btn:hover { color: white; background: #334155; }

    /* --- LIVE AGENT STATUS HUB & MICRO-ANIMATIONS --- */
    .agent-hub {
      background: linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(30, 27, 75, 0.75) 50%, rgba(15, 23, 42, 0.95) 100%);
      border: 1px solid rgba(99, 102, 241, 0.35);
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(16px);
    }
    .hub-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .hub-status-box {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 280px;
    }
    .hub-avatar-wrapper {
      position: relative;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .hub-avatar-wrapper.active-read { background: linear-gradient(135deg, #0284c7, #0369a1); box-shadow: 0 0 24px rgba(56, 189, 248, 0.6); }
    .hub-avatar-wrapper.active-write { background: linear-gradient(135deg, #059669, #047857); box-shadow: 0 0 24px rgba(52, 211, 153, 0.6); }
    .hub-avatar-wrapper.active-build { background: linear-gradient(135deg, #d97706, #b45309); box-shadow: 0 0 24px rgba(251, 191, 36, 0.6); }
    .hub-avatar-wrapper.active-test { background: linear-gradient(135deg, #7c3aed, #6d28d9); box-shadow: 0 0 24px rgba(167, 139, 250, 0.6); }
    .hub-avatar-wrapper.active-git { background: linear-gradient(135deg, #4f46e5, #4338ca); box-shadow: 0 0 24px rgba(129, 140, 248, 0.6); }
    .hub-avatar-wrapper.active-command { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 0 24px rgba(6, 182, 212, 0.6); }
    .hub-avatar-wrapper.active-idle { background: #1e293b; border: 1px solid #334155; }
    
    .hub-avatar-icon {
      display: inline-block;
      transition: transform 0.3s ease;
    }
    .anim-spin { animation: spin 2s linear infinite; }
    .anim-pulse { animation: pulse 1.5s ease-in-out infinite; }
    .anim-float { animation: float 2s ease-in-out infinite; }
    .anim-breath { animation: breath 3s ease-in-out infinite; }

    @keyframes spin { 100% { transform: rotate(360deg); } }
    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @keyframes breath { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.75; transform: scale(0.96); } }

    .hub-text h2 {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hub-target-pill {
      display: inline-block;
      max-width: 540px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 10px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #94a3b8;
    }
    .hub-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .hub-badge-live {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.4);
      color: #4ade80;
    }
    .hub-badge-idle {
      background: rgba(148, 163, 184, 0.1);
      border: 1px solid rgba(148, 163, 184, 0.2);
      color: #94a3b8;
    }
    
    /* Metrics Counter Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 14px;
    }
    .metric-card {
      background: rgba(15, 23, 42, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.2s;
    }
    .metric-card:hover {
      background: rgba(30, 41, 59, 0.7);
      border-color: rgba(99, 102, 241, 0.3);
      transform: translateY(-1px);
    }
    .metric-icon { font-size: 18px; }
    .metric-data { display: flex; flex-direction: column; }
    .metric-val { font-size: 15px; font-weight: 700; color: #f8fafc; font-family: 'JetBrains Mono', monospace; }
    .metric-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.3px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">🤖</div>
      <span>Local Dev Workspace</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <!-- LIVE AGENT STATUS PILL (LARGE PROMINENT ICON) -->
      <div id="header-agent-status" class="status-pill" style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%); border: 1.5px solid rgba(99, 102, 241, 0.45); display: inline-flex; align-items: center; gap: 10px; padding: 5px 16px 5px 8px; border-radius: 9999px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), 0 0 12px rgba(99, 102, 241, 0.2); transition: all 0.3s ease;">
        <div id="hub-avatar" class="hub-avatar-wrapper active-idle" style="width: 36px; height: 36px; min-width: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); transition: all 0.3s ease;">
          <span id="hub-icon" class="hub-avatar-icon anim-breath">💤</span>
        </div>
        <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
          <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 700;">Live Agent Status</span>
          <span id="hub-label" style="font-weight: 700; color: #f8fafc; font-size: 13.5px; letter-spacing: -0.2px;">Standby & Ready for AI Instructions</span>
        </div>
      </div>
      <div class="status-pill">
        <div class="dot"></div>
        <span>Server Online (:${port})</span>
      </div>
      <button onclick="shutdownMcpServer()" class="btn btn-sm" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-weight: 700; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.3)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.15)'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
        <span>Stop & Quit Core Server</span>
      </button>
    </div>
  </header>

  <main class="container">
    <!-- METRICS COUNTER BAR -->
    <div class="agent-hub" style="padding: 14px 20px; margin-bottom: 20px;">
      <div class="metrics-grid" style="border-top: none; padding-top: 0;">
        <div class="metric-card">
          <div class="metric-icon">📖</div>
          <div class="metric-data">
            <span id="stat-read" class="metric-val">0</span>
            <span class="metric-label">Files Read</span>
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-icon">✍️</div>
          <div class="metric-data">
            <span id="stat-write" class="metric-val">0</span>
            <span class="metric-label">Code Edits</span>
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-icon">⚙️</div>
          <div class="metric-data">
            <span id="stat-build" class="metric-val">0</span>
            <span class="metric-label">Builds</span>
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-icon">🧪</div>
          <div class="metric-data">
            <span id="stat-test" class="metric-val">0</span>
            <span class="metric-label">Tests</span>
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-icon">🌿</div>
          <div class="metric-data">
            <span id="stat-git" class="metric-val">0</span>
            <span class="metric-label">Git Ops</span>
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-icon">⚡</div>
          <div class="metric-data">
            <span id="stat-cmd" class="metric-val">0</span>
            <span class="metric-label">Commands</span>
          </div>
        </div>
      </div>
    </div>

    <nav class="nav-tabs">
      <button class="tab-btn active" onclick="switchTab('projects', this)">📁 Projects & Permissions</button>
      <button class="tab-btn" onclick="switchTab('tools', this)">🛠️ MCP Tools (45)</button>
      <button class="tab-btn" onclick="switchTab('logs', this)">📋 Live Activity Logs</button>
      <button class="tab-btn" onclick="switchTab('connection', this)">🔌 MCP Setup Guide</button>
    </nav>

    <!-- TAB 1: PROJECTS & PERMISSIONS -->
    <div id="tab-projects">
      <!-- GLOBAL TOOL PERMISSIONS SETTINGS BAR -->
      <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95)); border: 1px solid rgba(99, 102, 241, 0.4); border-radius: 14px; padding: 18px 22px; margin-bottom: 16px; box-shadow: 0 6px 24px rgba(0,0,0,0.3);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(99, 102, 241, 0.2); display: flex; align-items: center; justify-content: center; color: #818cf8; font-size: 18px;">🛡️</div>
            <div>
              <strong style="font-size: 15px; color: #f8fafc;">Global Tool Permissions (การตั้งค่าสิทธิ์ระดับ Global)</strong>
              <p style="font-size: 12px; color: var(--text-muted); margin: 0;">กำหนดสิทธิ์ความปลอดภัยส่วนกลาง มีผลบังคับใช้กับทุกโปรเจกต์และทุก AI Session ทันที</p>
            </div>
          </div>
          <span class="perm-badge perm-allowed" id="global-perm-status-badge">✓ Global Policy Active</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
          <label style="display: flex; align-items: center; gap: 10px; background: rgba(15, 23, 42, 0.7); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;">
            <input type="checkbox" id="gperm-read" onchange="toggleGlobalPerm('canRead', this.checked)">
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">📖 Read Files</div>
              <div style="font-size: 11px; color: var(--text-muted);">อ่านโค้ด & ค้นหาไฟล์</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; background: rgba(15, 23, 42, 0.7); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;">
            <input type="checkbox" id="gperm-write" onchange="toggleGlobalPerm('canWrite', this.checked)">
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">✍️ Write & Edit</div>
              <div style="font-size: 11px; color: var(--text-muted);">แก้ไข/สร้าง/ลบไฟล์</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; background: rgba(15, 23, 42, 0.7); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;">
            <input type="checkbox" id="gperm-cmd" onchange="toggleGlobalPerm('canRunCommand', this.checked)">
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">⚡ Run Terminal</div>
              <div style="font-size: 11px; color: var(--text-muted);">รัน Shell Commands</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; background: rgba(15, 23, 42, 0.7); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;">
            <input type="checkbox" id="gperm-skills" onchange="toggleGlobalPerm('canUseSkills', this.checked)">
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">🪄 Skills Discovery</div>
              <div style="font-size: 11px; color: var(--text-muted);">โหลดกติกา & สกิลพิเศษ</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; background: rgba(15, 23, 42, 0.7); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;">
            <input type="checkbox" id="gperm-handoff" onchange="toggleGlobalPerm('canUseHandoff', this.checked)">
            <div>
              <div style="font-size: 13px; font-weight: 700; color: #f8fafc;">📋 Handoff Memory</div>
              <div style="font-size: 11px; color: var(--text-muted);">บันทึก Session Handoff</div>
            </div>
          </label>
        </div>
      </div>

      <!-- AUTO-START TUNNEL SETTINGS BAR -->
      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 20px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 18px;">⚡</span>
          <div>
            <strong style="font-size: 14px; color: var(--text);">Auto-Start Tunnel on Boot</strong>
            <p style="font-size: 12px; color: var(--text-muted); margin: 0;">จดจำการตั้งค่าและเปิด Tunnel อัตโนมัติเมื่อเริ่มโปรแกรม</p>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
            <input type="radio" name="auto-tunnel-choice" value="openai" onchange="updateTunnelPreference('openai')">
            <span>⚡ OpenAI Tunnel</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
            <input type="radio" name="auto-tunnel-choice" value="ngrok" onchange="updateTunnelPreference('ngrok')">
            <span>🌐 Ngrok</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
            <input type="radio" name="auto-tunnel-choice" value="none" onchange="updateTunnelPreference('none')">
            <span style="color: var(--text-muted);">⏹️ None (Manual)</span>
          </label>
        </div>
      </div>

      <!-- TUNNEL CONTROL CONTAINER -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <!-- NGROK CONTROL CARD -->
        <div class="active-banner" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.08)); border-color: rgba(99, 102, 241, 0.3); margin-bottom: 0;">
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="color: #a78bfa; margin-bottom: 0;">🌐 Ngrok Tunnel</h3>
                <span id="ngrok-status-pill" class="perm-badge perm-denied">🔴 Disconnected</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="openNgrokProfilesModal()">⚙️ Accounts</button>
            </div>
            
            <!-- NGROK ACCOUNT PROFILE SELECTOR -->
            <div style="margin-bottom: 10px; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.06);">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">ACTIVE NGROK PROFILE:</span>
                <span id="ngrok-active-domain-tag" style="font-size: 10px; color: #38bdf8; font-family: monospace;"></span>
              </div>
              <select id="select-ngrok-account-profile" class="form-control" style="font-size: 12px; padding: 4px 8px; margin-bottom: 0;" onchange="onNgrokAccountProfileChange(this.value)">
                <!-- Ngrok account profiles dynamically loaded here -->
              </select>
            </div>

            <div id="ngrok-url-display" style="font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--text-muted); word-break: break-all; margin-bottom: 8px;">
              Tunnel is currently stopped.
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-start-ngrok" class="btn btn-sm" style="flex: 1; background: #22c55e; color: #04101e; font-weight: 700;" onclick="startNgrokTunnel()">▶️ Start</button>
                <button type="button" id="btn-stop-ngrok" class="btn btn-danger btn-sm" style="flex: 1;" onclick="stopNgrokTunnel()">⏹️ Stop</button>
              </div>
            </div>
          </div>
        </div>

        <!-- OPENAI OFFICIAL TUNNEL CLIENT CARD -->
        <div class="active-banner" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.08)); border-color: rgba(16, 185, 129, 0.3); margin-bottom: 0;">
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="color: #10b981; margin-bottom: 0;">⚡ OpenAI Tunnel</h3>
                <span id="openai-tunnel-status-pill" class="perm-badge perm-denied">🔴 Disconnected</span>
              </div>
              <a href="http://127.0.0.1:8080/ui" target="_blank" rel="noreferrer" class="btn btn-secondary btn-sm" style="font-size: 11px; text-decoration: none; display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-color: rgba(16, 185, 129, 0.4);" title="Open tunnel-client local web UI at http://127.0.0.1:8080/ui">
                <span>🔍 Open UI (8080)</span>
              </a>
            </div>
            
            <div id="openai-tunnel-info-display" style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-muted); word-break: break-all; margin-bottom: 10px;">
              Official OpenAI tunnel-client daemon
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; gap: 6px;">
                <select id="select-openai-tunnel-profile" class="form-control" style="flex: 1; font-size: 11px;" onchange="onOpenAiProfileChange(this.value)"></select>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addOpenAiProfile()">＋ Add</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteOpenAiProfile()">🗑️</button>
              </div>
              <input type="text" id="openai-profile-name-input" class="form-control" placeholder="Profile name" style="font-size: 11px; padding: 4px 8px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <input type="text" id="openai-profile-tunnel-id-input" class="form-control" placeholder="Tunnel ID" style="font-family: monospace; font-size: 11px; padding: 4px 8px;">
                <input type="password" id="openai-profile-runtime-key-input" class="form-control" placeholder="Runtime Key (leave blank to keep)" style="font-family: monospace; font-size: 11px; padding: 4px 8px;">
              </div>
              <div id="openai-runtime-key-configured" style="font-size: 11px; color: var(--text-muted);">Runtime key: Not configured</div>
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px;" onclick="saveOpenAiProfile()">💾 Save Profile</button>
                <button type="button" id="btn-toggle-openai-tunnel" class="btn btn-sm" style="flex: 1; background: #10b981; color: #04101e; font-weight: 700; font-size: 12px;" onclick="toggleOpenAiTunnel()">▶️ Start</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section-header" style="margin-top: 10px;">
        <div>
          <h2>📁 Registered Projects & Workspaces</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">
            AI will only operate inside a project after it is explicitly selected (Zero default access)
          </p>
        </div>
        <button class="btn" onclick="openAddModal()">+ Add New Project</button>
      </div>

      <div id="projects-grid" class="grid-projects"></div>
    </div>

    <!-- TAB: MCP TOOLS EXPLORER (45 TOOLS) -->
    <div id="tab-tools" style="display: none;">
      <div class="section-header">
        <div>
          <h2>🛠️ Available MCP Tools & Capabilities (45 Active Tools)</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">
            ชุดเครื่องมือมาตรฐานที่ AI สามารถเรียกใช้งานได้เมื่อเชื่อมต่อกับ Local Dev Tool MCP
          </p>
        </div>
        <span class="status-pill">🚀 Phase P1+ Full Suite Active</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <!-- Card 1: Workspace & Boundary -->
        <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
          <h3 style="color: #38bdf8; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>📁 1. Workspace & Boundary</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">3 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li><code>list_projects</code>: แสดงรายชื่อโปรเจกต์ที่ลงทะเบียนทั้งหมด</li>
            <li>Project operations require explicit project targeting.</li>
            
          </ul>
        </div>

        <!-- Card 2: Code Editing & Patching -->
        <div style="background: var(--card); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 20px;">
          <h3 style="color: #4ade80; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>✍️ 2. Code Editing & Patching</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">4 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li><code>read_file</code>: อ่านโค้ดแบบระบุช่วงบรรทัด (Line Range)</li>
            <li><code>write_file</code>: สร้างหรือเขียนทับไฟล์ใหม่</li>
            <li><code>edit_file</code>: แก้ไขข้อความในไฟล์แบบแม่นยำ</li>
            <li style="color: #4ade80; font-weight: 600;"><code>apply_patch</code> ⭐: แก้ไขหลายไฟล์/หลายจุดใน 1 คำสั่ง (Diff/Chunks)</li>
          </ul>
        </div>

        <!-- Card 3: Search & Discovery -->
        <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
          <h3 style="color: #a78bfa; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🔍 3. Search & Exploration</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">3 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li><code>find_files</code>: ค้นหาไฟล์ด้วย Glob Pattern (เช่น **/*.ts)</li>
            <li><code>search_files</code>: ค้นหาเนื้อหาในไฟล์ (Grep Code)</li>
            <li><code>list_directory</code>: ดูโครงสร้างโฟลเดอร์และไฟล์</li>
          </ul>
        </div>

        <!-- Card 4: Git Engine -->
        <div style="background: var(--card); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 12px; padding: 20px;">
          <h3 style="color: #c084fc; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🌳 4. Git Engine</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">4 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li><code>git_status</code>: ตรวจสอบสถานะ Branch และ Working Tree</li>
            <li><code>git_diff</code>: ดู Diff การเปลี่ยนแปลงทั้ง Staged และ Unstaged</li>
            <li style="color: #c084fc; font-weight: 600;"><code>git_log</code> ⭐: ดูประวัติ Commit ย้อนหลัง (Hash, Author, Message)</li>
            <li style="color: #c084fc; font-weight: 600;"><code>git_commit</code> ⭐: Stage และ Commit โค้ดได้จบในแชท</li>
          </ul>
        </div>

        <!-- Card 5: Quality & Diagnostics -->
        <div style="background: var(--card); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px; padding: 20px;">
          <h3 style="color: #fbbf24; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🩺 5. Diagnostics & Health</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">1 Tool</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li style="color: #fbbf24; font-weight: 600;"><code>project_diagnostics</code> ⭐: รัน typecheck, lint, test, build พร้อมระบบสกัด Error และเลขบรรทัดให้ AI แก้บั๊กทันที</li>
          </ul>
        </div>

        <!-- Card 7: Process Execution -->
        <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
          <h3 style="color: #38bdf8; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>⚡ 7. Process Execution</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">4 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li><code>run_command</code>: รันคำสั่ง Terminal Shell (Sync หรือ Daemon)</li>
            <li><code>get_task_status</code>: ตรวจสอบสถานะ Background Task</li>
            <li><code>kill_task</code>: สั่งหยุด Background Process</li>
            <li><code>list_tasks</code>: ดูรายการคำสั่งที่กำลังรันอยู่ทั้งหมด</li>
          </ul>
        </div>

        <!-- Card 8: Memory & Skills -->
        <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
          <h3 style="color: #38bdf8; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🧠 8. Memory & Skills</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">5 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li><code>read_project_instructions</code>: อ่านกติกาโปรเจกต์ (AGENTS.md)</li>
            <li><code>read_handoff</code>: อ่าน Session Handoff เพื่อทำงานต่อ</li>
            <li><code>write_handoff</code>: บันทึกผลงานและแผนขั้นตอนถัดไป</li>
            <li><code>list_skills</code>: ดูคู่มือและ Runbooks ใน .skills/</li>
            <li><code>read_skill</code>: อ่านเนื้อหาคู่มือแก้ปัญหาเฉพาะทาง</li>
          </ul>
        </div>

        <!-- Card 10: Snapshot & Semantic Code Intelligence -->
        <div style="background: var(--card); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 20px;">
          <h3 style="color: #38bdf8; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🧠 10. Snapshot & Code Intelligence</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">3 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li style="color: #38bdf8; font-weight: 600;"><code>get_project_snapshot</code> ⭐: รวมสถานะ Branch, HEAD, Handoff, และ Rules ใน 1 Call (Hash-Guarded ประหยัด Token)</li>
            <li style="color: #38bdf8; font-weight: 600;"><code>list_symbols</code> ⭐: แยกสารบัญ Classes, Methods, Interfaces ในไฟล์ C#, TS, Vue (AST Compiler)</li>
            <li style="color: #38bdf8; font-weight: 600;"><code>read_symbol</code> ⭐: ดึงเฉพาะ Implementation ของ Method นั้นโดยไม่ต้องโหลดทั้งไฟล์ 400 บรรทัด</li>
          </ul>
        </div>

        <!-- Card 11: Git Worktrees & Branch Comparison -->
        <div style="background: var(--card); border: 1px solid rgba(52, 211, 153, 0.35); border-radius: 12px; padding: 20px;">
          <h3 style="color: #34d399; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🌿 11. Git Worktrees & Branch Lifecycle</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">3 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li style="color: #34d399; font-weight: 600;"><code>git_sync_status</code> ⭐: ตรวจสอบ Ahead/Behind, Unpushed Commits, และ Workspace Fingerprint</li>
            <li style="color: #34d399; font-weight: 600;"><code>list_worktrees</code> ⭐: ตรวจสอบรายการ Git Worktrees ทั้งหมดสำหรับ Multi-Agent Isolation</li>
            <li style="color: #34d399; font-weight: 600;"><code>compare_branches</code> ⭐: คำนวณ Merge-Base, Commits Log และ Diff Summary ระหว่าง 2 Branch</li>
          </ul>
        </div>

        <!-- Card 12: Diagnostics & Build Checks -->
        <div style="background: var(--card); border: 1px solid rgba(251, 146, 60, 0.35); border-radius: 12px; padding: 20px;">
          <h3 style="color: #fb923c; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🧪 12. Diagnostics & Impact Testing</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">1 Tool</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li style="color: #fb923c; font-weight: 600;"><code>build_diagnostics</code> ⭐: Parse ข้อผิดพลาด MSBuild/TSC เป็น JSON โดยไม่กลืน Unparsed Error Lines</li>
          </ul>
        </div>

        <!-- Card 13: Safe File System Operations -->
        <div style="background: var(--card); border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 12px; padding: 20px;">
          <h3 style="color: #f43f5e; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🛡️ 13. Safe File Operations</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">4 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li style="color: #f43f5e; font-weight: 600;"><code>delete_file</code> ⭐: ลบไฟล์/โฟลเดอร์โดยไม่ผ่าน PowerShell Quoting</li>
            <li style="color: #f43f5e; font-weight: 600;"><code>move_file</code> ⭐: ย้าย/เปลี่ยนชื่อไฟล์แบบปลอดภัย</li>
            <li style="color: #f43f5e; font-weight: 600;"><code>hash_file</code> ⭐: คำนวณ SHA256 และขนาดไฟล์สำหรับ CAS Check</li>
            <li style="color: #f43f5e; font-weight: 600;"><code>compare_file_content</code> ⭐: เปรียบเทียบ 2 ไฟล์ระดับ Byte Identity</li>
          </ul>
        </div>

        <!-- Card 14: Automation & Advanced Search -->
        <div style="background: var(--card); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 12px; padding: 20px;">
          <h3 style="color: #a855f7; font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>🚀 14. Automation & Search</span>
            <span class="perm-badge perm-allowed" style="font-size: 11px;">3 Tools</span>
          </h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
            <li style="color: #a855f7; font-weight: 600;"><code>find_references</code> ⭐: ค้นหาจุดเรียกใช้งาน Class / Method ทั่ว Codebase</li>
            <li style="color: #a855f7; font-weight: 600;"><code>search_context</code> ⭐: ค้นหาโค้ดจัดกลุ่มตามไฟล์พร้อม Context 2-3 บรรทัด</li>
            <li style="color: #a855f7; font-weight: 600;"><code>close_feature_branch</code> ⭐: Atomic Branch Close (Verify, Merge, Test, Delete)</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- TAB 2: LIVE LOGS -->
    <div id="tab-logs" style="display: none;">
      <div class="section-header">
        <h2>📋 Live Activity Monitor (Auto-refresh 3s)</h2>
        <button class="btn btn-secondary btn-sm" onclick="fetchLogs()">🔄 Refresh Now</button>
      </div>
      <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">
        ตรวจสอบคำสั่งทั้งหมดที่ ChatGPT หรือ AI ส่งมาทำงานบนเครื่องคอมพิวเตอร์ของคุณแบบ Real-Time
      </p>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Parameters from AI</th>
            <th>Result / Output</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody id="logs-table-body"></tbody>
      </table>
    </div>

    <!-- TAB 3: CONNECTION -->
    <div id="tab-connection" style="display: none;">
      <div class="section-header">
        <h2>🔌 How to Connect AI to your Projects</h2>
      </div>

      <div style="background: var(--card); border: 1px solid #f59e0b40; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <h3 style="margin-bottom: 12px; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
          🔑 Your Secret API Key (ความปลอดภัย 100%)
        </h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 12px;">
          ระบบได้เพิ่มรหัสผ่านลับนี้ เพื่อป้องกันไม่ให้คนอื่นในอินเทอร์เน็ตเข้ามาเรียกใช้งาน MCP Server ของคุณ:
        </p>
        <div class="code-box" style="display: flex; justify-content: space-between; align-items: center;">
          <code id="api-key-display" style="font-family: 'JetBrains Mono', monospace; color: #4ade80; font-size: 15px; font-weight: 700;">loading...</code>
          <button class="btn btn-secondary btn-sm" onclick="copyApiKey()">Copy Key</button>
        </div>
      </div>
      
      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="display: flex; align-items: center; gap: 8px; margin: 0 0 4px 0;">
              <span>🌐 ChatGPT Custom GPT Actions & OpenAPI Profile Setup</span>
            </h3>
            <p style="font-size: 13px; color: var(--text-muted); margin: 0;">เลือกหรือปรับแต่งชุดเครื่องมือสำหรับ ChatGPT Actions (เพดานไม่เกิน 30 Operations)</p>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <select id="select-active-profile" class="form-control" style="width: auto; font-size: 13px; padding: 6px 12px;" onchange="onSelectProfileChange(this.value)">
              <option value="core">⭐ Core Dev (${opCounts.core} Ops - แนะนำ)</option>
              <option value="agent">🤖 Agent Dev (${opCounts.agent} Ops)</option>
              <option value="extension">🧩 Skills & Extension (${opCounts.extension} Ops)</option>
              <option value="full">📦 Full MCP Spec (${opCounts.full} Ops)</option>
              <option value="custom">🎨 Custom Tailored...</option>
            </select>
            <button type="button" class="btn btn-secondary btn-sm" onclick="openProfileCustomizerModal()">🛠️ Customize Tools</button>
            <span id="profile-ops-badge" style="font-size: 12px; padding: 4px 10px; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 9999px; font-weight: 600;">
              ✅ ChatGPT Ready: ${opCounts.core} / 30 Ops Limit
            </span>
          </div>
        </div>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 12px;">
          1. เลือก Profile ที่ต้องการ แล้วนำ URL หรือคัดลอก Schema JSON ไปใส่ที่ <strong>ChatGPT ➔ Edit GPT ➔ Actions</strong>:
        </p>
        <div style="display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" id="btn-profile-core" onclick="setOpenApiProfile('core')" style="background: var(--primary); color: #fff;">⭐ Core Dev (${opCounts.core} Ops - แนะนำ)</button>
          <button class="btn btn-secondary btn-sm" id="btn-profile-agent" onclick="setOpenApiProfile('agent')">🤖 Agent Dev (${opCounts.agent} Ops)</button>
          <button class="btn btn-secondary btn-sm" id="btn-profile-extension" onclick="setOpenApiProfile('extension')">🧩 Skills & Extension (${opCounts.extension} Ops)</button>
          <button class="btn btn-secondary btn-sm" id="btn-profile-full" onclick="setOpenApiProfile('full')">📦 Full Spec (${opCounts.full} Ops)</button>
          <button class="btn btn-secondary btn-sm" id="btn-profile-custom" onclick="openProfileCustomizerModal()">🎨 Custom...</button>
        </div>
        <div id="profile-desc-display" style="font-size: 13px; color: #a78bfa; margin-bottom: 10px; padding: 8px 12px; background: rgba(99, 102, 241, 0.1); border-radius: 6px; border-left: 3px solid #6366f1;">
          ⭐ <strong>Core Dev Profile (${opCounts.core} Ops)</strong>: Workspace Health, Files CRUD, Grep Search, Git Status/Diff/Branch/Push, Bash Terminal, Snapshot, Safe Patch, and Skills System (list_skills & read_skill). (Recommended for ChatGPT!).
        </div>
        <div class="code-box" style="margin-bottom: 8px;">
          <div style="position: absolute; top: 8px; right: 8px; display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="copyOpenApiUrl()">🔗 Copy URL</button>
            <button class="btn btn-sm" style="font-size: 11px; padding: 2px 8px; background: #6366f1; color: #fff;" onclick="copyOpenApiJsonRaw()">📋 Copy Raw Schema (JSON)</button>
          </div>
          <pre id="openapi-url-display" style="color: #38bdf8; word-break: break-all; margin-top: 14px;"></pre>
        </div>
        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px; line-height: 1.4;">
          💡 <em>ทิป: หากใช้ Ngrok Free แล้ว ChatGPT โหลดจาก URL ไม่ผ่าน ให้กดปุ่ม <strong>"📋 Copy Raw Schema (JSON)"</strong> แล้วนำข้อความ JSON ไปวางลงในช่อง <strong>Schema</strong> ของ ChatGPT Actions โดยตรงได้เลยครับ</em>
        </div>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 12px;">
          2. ที่หัวข้อ <strong>Authentication</strong> เลือก <strong>API Key</strong> ➔ <strong>Auth Type: Bearer</strong> ➔ นำ Secret API Key ด้านบนไปวาง
        </p>
      </div>

      <div style="background: var(--card); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="color: #38bdf8; display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
              🤖 ChatGPT Custom GPT Instructions (ใส่แค่ 3 บรรทัดสั้นๆ ⭐)
            </h3>
            <span style="font-size: 12px; color: #4ade80; font-weight: 600;">⚡ Server-Driven Dynamic Prompt Injection (เซิร์ฟเวอร์จะส่งกติกาตัวเต็มให้ AI เองตอนสลับโปรเจกต์)</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="copySystemPrompt()">📋 Copy Instructions</button>
        </div>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 12px;">
          นำข้อความสั้นกระชับด้านล่างนี้ ไปใส่ในช่อง <strong>Instructions</strong> ของ Custom GPT เพื่อประหยัด Token ตั้งต้น โดย AI จะได้รับกติกาเฉพาะของแต่ละโปรเจกต์จากเซิร์ฟเวอร์อัตโนมัติ:
        </p>
        <div class="code-box" style="margin-bottom: 14px;">
          <button class="copy-btn" onclick="copySystemPrompt()">Copy</button>
          <pre id="system-prompt-text" style="color: #f8fafc; font-size: 13px; line-height: 1.6; white-space: pre-wrap; font-family: 'JetBrains Mono', monospace;">You are ChatDev, an expert AI Software Engineer connected to the user's local development environment via Actions.

### Startup Workflow:
1. Every project operation must include the explicit project name. Never switch workspaces; resolve the target project directly.
2. Strictly follow the guidelines, rules, and skills provided dynamically in the server's 'systemPrompt' and 'projectInstructions' (AGENTS.md).
3. Always work using relative paths ('.') inside the active workspace.</pre>
        </div>

        <details style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 16px;">
          <summary style="cursor: pointer; color: #94a3b8; font-size: 13px; font-weight: 600;">
            📜 ดูตัวอย่าง Full System Prompt ที่เซิร์ฟเวอร์จะส่งให้ AI อัตโนมัติ (สำหรับศึกษา)
          </summary>
          <div style="margin-top: 10px;">
            <pre style="color: #94a3b8; font-size: 11px; line-height: 1.5; white-space: pre-wrap; font-family: monospace;">- Workspace Boundary & Relative Path Enforcements
- Dynamic Project Instructions (AGENTS.md / CLAUDE.md)
- Domain Skills Auto-Discovery (.skills/) with on-demand runbook loading
- Real-time Permission Guard (Read, Write, Shell, Skills, Handoff)
- Memory Compaction Workflow (HANDOFF.md)
- Network Resilience & Silent Auto-Retry</pre>
          </div>
        </details>
      </div>

      <div style="background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
        <h3 style="margin-bottom: 12px;">🟣 Claude Desktop Configuration</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 12px;">
          ใส่ใน <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>:
        </p>
        <div class="code-box">
          <button class="copy-btn" onclick="copyClaudeConfig()">Copy</button>
          <pre id="claude-config-text" style="color: #a78bfa;">{
  "mcpServers": {
    "chat-dev": {
      "command": "node",
      "args": ["D:/labs/chat-dev-mcp/dist/index.js"]
    }
  }
}</pre>
        </div>
      </div>
    </div>
  </main>

  <!-- ADD / EDIT PROJECT MODAL -->
  <div id="project-modal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h3 id="modal-title">Add New Project</h3>
        <button onclick="closeModal()" style="background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer;">✕</button>
      </div>
      <form id="project-form" onsubmit="saveProject(event)">
        <input type="hidden" id="form-id">
        <div class="form-group">
          <label>Project Name *</label>
          <input type="text" id="form-name" class="form-control" placeholder="e.g. online-store-app" required>
        </div>
        <div class="form-group">
          <label>Directory Path on Computer *</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="form-path" class="form-control" placeholder="e.g. D:\\labs\\my-project" required style="flex:1;">
            <button type="button" class="btn btn-secondary" onclick="openFolderBrowser()">📂 Browse</button>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" id="form-desc" class="form-control" placeholder="e.g. React frontend application">
        </div>
        <div style="background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 12px; margin-bottom: 20px; font-size: 12px; color: var(--text-muted);">
          ℹ️ <strong>Global Permissions:</strong> สิทธิ์การเข้าถึง (Read / Write / Terminal / Skills / Handoff) ถูกควบคุมแบบรวมศูนย์ผ่านแถบ <strong>Global Tool Permissions</strong> ด้านบนค่ะ
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn">Save Project</button>
        </div>
      </form>
    </div>
  </div>

  <!-- FOLDER BROWSER MODAL -->
  <div id="browser-modal" class="modal-overlay" style="z-index: 60;">
    <div class="modal" style="max-width: 650px;">
      <div class="modal-header">
        <h3>📂 Browse Folder on Computer</h3>
        <button type="button" onclick="closeFolderBrowser()" style="background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer;">✕</button>
      </div>
      
      <div style="margin-bottom: 12px; display: flex; gap: 8px; align-items: center;">
        <button type="button" class="btn btn-secondary btn-sm" id="browser-up-btn" onclick="navigateBrowserUp()">⬆️ Parent Folder</button>
        <input type="text" id="browser-current-path" class="form-control" style="font-family: monospace; font-size: 13px;" onkeypress="if(event.key === 'Enter'){ browseFolder(this.value); }">
        <button type="button" class="btn btn-secondary btn-sm" onclick="browseFolder(document.getElementById('browser-current-path').value)">Go</button>
      </div>

      <div id="browser-error" style="display:none; color:#f87171; font-size:13px; margin-bottom:10px; padding:8px; background:rgba(239,68,68,0.1); border-radius:6px;"></div>

      <div id="browser-list" style="max-height: 320px; overflow-y: auto; background: #0b0f19; border: 1px solid var(--border); border-radius: 8px; padding: 6px; margin-bottom: 16px;">
        <!-- Directory items rendered here -->
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size: 12px; color: var(--text-muted);">Click a folder to open it</span>
        <div style="display:flex; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeFolderBrowser()">Cancel</button>
          <button type="button" class="btn" onclick="selectCurrentFolder()">✓ Select This Directory</button>
        </div>
      </div>
    </div>
  </div>

  <!-- DIAGNOSTICS MODAL -->
  <div id="diag-modal" class="modal-overlay" style="z-index: 65;">
    <div class="modal" style="max-width: 720px;">
      <div class="modal-header">
        <h3 id="diag-modal-title">🩺 Project Diagnostics</h3>
        <button type="button" onclick="closeDiagModal()" style="background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer;">✕</button>
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="font-size:13px; color:var(--text-muted); display:block; margin-bottom:8px;">Choose Diagnostic Task to Run:</label>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="runUiDiagnostic('typecheck')">🔍 Typecheck</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="runUiDiagnostic('lint')">🧹 Lint</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="runUiDiagnostic('test')">🧪 Test</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="runUiDiagnostic('build')">🏗️ Build</button>
          <button type="button" class="btn btn-sm" style="background:#fbbf24; color:#04101e; font-weight:700;" onclick="runUiDiagnostic('all')">⭐ Run All</button>
        </div>
      </div>

      <div id="diag-running" style="display:none; padding:16px; text-align:center; color:#38bdf8; font-weight:600;">
        ⏳ Running diagnostic task... please wait...
      </div>

      <div id="diag-result-box" style="display:none; max-height: 380px; overflow-y: auto; background: #0b0f19; border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; white-space: pre-wrap;"></div>

      <div style="display:flex; justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" onclick="closeDiagModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- PROFILE CUSTOMIZER MODAL -->
  <div id="profile-customizer-modal" class="modal-overlay" style="z-index: 70;">
    <div class="modal" style="max-width: 820px; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 22px;">🛠️</span>
          <div>
            <h3 style="margin: 0; font-size: 16px;">Customize Tunnel OpenAPI Profile</h3>
            <p style="font-size: 12px; color: var(--text-muted); margin: 0;">เลือกเปิด/ปิดเครื่องมือที่ต้องการให้อยู่ใน OpenAPI Schema ของ Tunnel</p>
          </div>
        </div>
        <button type="button" onclick="closeProfileCustomizerModal()" style="background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer;">✕</button>
      </div>

      <!-- MODAL SUBHEADER WITH COUNTER & PRESETS -->
      <div style="padding: 12px 16px; background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 12px; font-weight: 600; color: var(--text);">Quick Presets:</span>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px;" onclick="applyPresetToCustomizer('core')">⭐ Core (${opCounts.core})</button>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px;" onclick="applyPresetToCustomizer('agent')">🤖 Agent (${opCounts.agent})</button>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px;" onclick="applyPresetToCustomizer('extension')">🧩 Ext (${opCounts.extension})</button>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px;" onclick="applyPresetToCustomizer('full')">📦 Full (${opCounts.full})</button>
        </div>
        <div>
          <span id="customizer-ops-counter" style="font-size: 12px; padding: 4px 10px; border-radius: 9999px; font-weight: 700; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);">
            25 / 30 Ops (ChatGPT Ready ✅)
          </span>
        </div>
      </div>

      <!-- TOOLS CHECKBOX LIST (CATEGORIZED) -->
      <div id="customizer-tools-container" style="flex: 1; overflow-y: auto; max-height: 50vh; padding-right: 6px; display: flex; flex-direction: column; gap: 14px;">
        <!-- Categories and tool checkboxes dynamically injected here -->
      </div>

      <div style="display:flex; justify-content:space-between; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);">
        <button type="button" class="btn btn-secondary btn-sm" onclick="selectAllCustomizerTools(false)">Clear All</button>
        <div style="display: flex; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="closeProfileCustomizerModal()">Cancel</button>
          <button type="button" class="btn" style="background: #22c55e; color: #04101e; font-weight: 700;" onclick="saveCustomizerProfile()">💾 Save & Apply Setting</button>
        </div>
      </div>
    </div>
  </div>

  <!-- NGROK ACCOUNTS & DOMAINS MODAL -->
  <div id="modal-ngrok-accounts" class="modal-overlay" style="z-index: 75;">
    <div class="modal" style="max-width: 680px; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 22px;">🌐</span>
          <div>
            <h3 style="margin: 0; font-size: 16px;">Ngrok Tunnel Account Profiles</h3>
            <p style="font-size: 12px; color: var(--text-muted); margin: 0;">จัดการ Account, Authtoken และ Reserved Static Domains/URLs</p>
          </div>
        </div>
        <button type="button" onclick="closeNgrokProfilesModal()" style="background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer;">✕</button>
      </div>

      <!-- LIST OF EXISTING NGROK PROFILES -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label style="font-size: 13px; font-weight: 600; color: var(--text);">Saved Ngrok Profiles:</label>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="showAddNgrokProfileForm()">➕ Add New Profile</button>
        </div>
        <div id="ngrok-profiles-list" style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
          <!-- Profile items rendered dynamically -->
        </div>
      </div>

      <!-- ADD / EDIT NGROK PROFILE FORM -->
      <form id="form-ngrok-profile" onsubmit="saveNgrokProfileForm(event)" style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid var(--border);">
        <input type="hidden" id="ngrok-form-id" value="">
        <h4 id="ngrok-form-title" style="margin: 0 0 12px 0; font-size: 13px; color: #a78bfa;">➕ Add New Ngrok Profile</h4>
        
        <div class="form-group" style="margin-bottom: 10px;">
          <label style="font-size: 12px;">Profile / Account Name *</label>
          <input type="text" id="ngrok-form-name" class="form-control" placeholder="e.g. Work Pro, Personal Free, Staging Tunnel" required style="font-size: 13px; padding: 6px 10px;">
        </div>

        <div class="form-group" style="margin-bottom: 10px;">
          <label style="font-size: 12px;">Ngrok Authtoken *</label>
          <div style="position: relative;">
            <input type="password" id="ngrok-form-token" class="form-control" placeholder="2abc..." required style="font-family: monospace; font-size: 12px; padding: 6px 36px 6px 10px;">
            <button type="button" onclick="toggleFormTokenVisibility()" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-muted); cursor: pointer;">👁️</button>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 10px;">
          <label style="font-size: 12px;">Custom / Static Reserved Domain or Subdomain (Optional)</label>
          <input type="text" id="ngrok-form-domain" class="form-control" placeholder="e.g. my-app.ngrok-free.dev or api.mycompany.com" style="font-family: monospace; font-size: 12px; padding: 6px 10px;">
          <small style="color: var(--text-muted); font-size: 11px;">เว้นว่างไว้หากต้องการให้ Ngrok สุ่ม URL อัตโนมัติ</small>
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-size: 12px;">Description (Optional)</label>
          <input type="text" id="ngrok-form-desc" class="form-control" placeholder="e.g. Used for Company Custom GPT Actions" style="font-size: 12px; padding: 6px 10px;">
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="resetNgrokProfileForm()">Reset Form</button>
          <button type="submit" class="btn btn-sm" style="background: #22c55e; color: #04101e; font-weight: 700;">💾 Save Profile</button>
        </div>
      </form>

      <div style="display: flex; justify-content: flex-end; margin-top: 14px;">
        <button type="button" class="btn btn-secondary" onclick="closeNgrokProfilesModal()">Close</button>
      </div>
    </div>
  </div>

  <script>
    let currentDiagProject = '';

    function openDiagModal(projectName) {
      currentDiagProject = projectName;
      document.getElementById('diag-modal-title').innerText = '🩺 Project Diagnostics: ' + projectName;
      document.getElementById('diag-result-box').style.display = 'none';
      document.getElementById('diag-running').style.display = 'none';
      document.getElementById('diag-modal').style.display = 'flex';
    }

    function closeDiagModal() {
      document.getElementById('diag-modal').style.display = 'none';
    }

    async function runUiDiagnostic(task) {
      const runningEl = document.getElementById('diag-running');
      const boxEl = document.getElementById('diag-result-box');
      runningEl.style.display = 'block';
      boxEl.style.display = 'none';

      try {
        const res = await fetch('/api/ui/diagnostics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, project: currentDiagProject })
        });
        const data = await res.json();
        runningEl.style.display = 'none';
        boxEl.style.display = 'block';

        if (data.overallSuccess !== undefined) {
          boxEl.innerHTML = \`<span style="color:\${data.overallSuccess ? '#4ade80' : '#f87171'}; font-weight:bold;">Overall Result: \${data.overallSuccess ? 'PASSED ✅' : 'FAILED ❌'}</span>\\n\\n\` +
            data.tasks.map(t => \`[\${t.task.toUpperCase()}] \${t.summary}\\n\${t.rawOutput}\`).join('\\n\\n----------------------------------------\\n\\n');
        } else {
          boxEl.innerHTML = \`<span style="color:\${data.success ? '#4ade80' : '#f87171'}; font-weight:bold;">\${data.summary}</span>\\n\\nCommand: \${data.commandRun}\\n\\n\${data.rawOutput}\`;
        }
      } catch (err) {
        runningEl.style.display = 'none';
        boxEl.style.display = 'block';
        boxEl.innerHTML = '<span style="color:#f87171;">Failed to execute diagnostic: ' + err.message + '</span>';
      }
    }
    let projectsData = [];
    let currentOpenApiProfile = 'core';
    let toolCatalog = [];
    let customToolsList = [];

    async function fetchProfilePreference() {
      try {
        const res = await fetch('/api/ui/profile/preference');
        const data = await res.json();
        if (data.catalog) toolCatalog = data.catalog;
        currentOpenApiProfile = data.profile || 'core';
        customToolsList = data.customTools || [];
        
        const sel = document.getElementById('select-active-profile');
        if (sel) sel.value = currentOpenApiProfile;
        
        setOpenApiProfile(currentOpenApiProfile);
        updateActiveProfileBadge();
      } catch (err) {
        console.error('Failed to fetch profile preference:', err);
      }
    }

    function updateActiveProfileBadge() {
      const badge = document.getElementById('active-profile-badge');
      if (!badge) return;
      const readyCss = 'font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); font-weight: 600;';
      const warnCss = 'font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); font-weight: 600;';
      if (currentOpenApiProfile === 'core') {
        badge.innerHTML = '${opCounts.core} Ops (ChatGPT Ready ✅)';
        badge.style.cssText = readyCss;
      } else if (currentOpenApiProfile === 'agent') {
        badge.innerHTML = '${opCounts.agent} Ops (ChatGPT Ready ✅)';
        badge.style.cssText = readyCss;
      } else if (currentOpenApiProfile === 'extension') {
        badge.innerHTML = '${opCounts.extension} Ops (ChatGPT Ready ✅)';
        badge.style.cssText = readyCss;
      } else if (currentOpenApiProfile === 'full') {
        badge.innerHTML = '${opCounts.full} Ops (Full MCP Spec 📦)';
        badge.style.cssText = 'font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-weight: 600;';
      } else if (currentOpenApiProfile === 'custom') {
        const count = customToolsList.length || 0;
        const isOk = count <= 30;
        badge.innerHTML = count + ' Ops (' + (isOk ? 'ChatGPT Ready ✅' : 'Exceeds 30 Limit ⚠️') + ')';
        badge.style.cssText = 'font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: ' + (isOk ? 'rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);' : 'rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);') + ' font-weight: 600;';
      }
    }

    async function onSelectProfileChange(profile) {
      if (profile === 'custom') {
        openProfileCustomizerModal();
        return;
      }
      currentOpenApiProfile = profile;
      setOpenApiProfile(profile);
      updateActiveProfileBadge();
      try {
        await fetch('/api/ui/profile/preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile })
        });
      } catch (err) {
        console.error('Failed to save profile:', err);
      }
    }

    function openProfileCustomizerModal() {
      const modal = document.getElementById('profile-customizer-modal');
      renderCustomizerTools();
      updateCustomizerCounter();
      if (modal) modal.style.display = 'flex';
    }

    function closeProfileCustomizerModal() {
      const modal = document.getElementById('profile-customizer-modal');
      if (modal) modal.style.display = 'none';
    }

    function renderCustomizerTools() {
      const container = document.getElementById('customizer-tools-container');
      if (!container || !toolCatalog.length) return;

      const categories = {};
      toolCatalog.forEach(t => {
        if (!categories[t.category]) categories[t.category] = [];
        categories[t.category].push(t);
      });

      const selected = new Set(
        currentOpenApiProfile === 'custom' && customToolsList.length > 0
          ? customToolsList
          : getPresetKeys(currentOpenApiProfile)
      );

      let html = '';
      for (const [cat, tools] of Object.entries(categories)) {
        html += '<div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 10px 14px;">';
        html += '<div style="font-size: 13px; font-weight: 700; color: #38bdf8; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">';
        html += '<span>' + cat + ' (' + tools.length + ')</span>';
        html += '<button type="button" class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 2px 6px;" onclick="toggleCategoryTools(\\'' + cat.replace(/'/g, "\\\\'") + '\\')">Toggle All</button>';
        html += '</div>';
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px;">';

        tools.forEach(t => {
          const isChecked = selected.has(t.path);
          html += '<label style="display: flex; align-items: flex-start; gap: 8px; font-size: 12px; cursor: pointer; padding: 6px 8px; border-radius: 6px; background: rgba(30, 41, 59, 0.4);">';
          html += '<input type="checkbox" class="tool-checkbox" data-path="' + t.path + '" data-cat="' + cat + '" ' + (isChecked ? 'checked' : '') + ' onchange="updateCustomizerCounter()" style="margin-top: 2px;">';
          html += '<div>';
          html += '<strong style="color: #f1f5f9; font-family: monospace;">' + t.name + '</strong>';
          html += '<div style="color: #94a3b8; font-size: 11px; line-height: 1.3;">' + t.description + '</div>';
          html += '</div>';
          html += '</label>';
        });

        html += '</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function getPresetKeys(preset) {
      const core = [
        '/api/workspace_health', '/api/get_project_snapshot', '/api/list_projects',
        '/api/project_overview',
        '/api/read_file', '/api/write_file', '/api/edit_file', '/api/apply_patch',
        '/api/list_directory', '/api/get_file_info', '/api/grep_search',
        '/api/find_by_name', '/api/symbol_index', '/api/git_status', '/api/git_diff',
        '/api/git_log', '/api/git_commit', '/api/git_branch', '/api/git_push',
        '/api/run_command', '/api/process_manager', '/api/run_tests', '/api/run_diagnostics',
        '/api/parse_diagnostics', '/api/suggest_tests', '/api/write_handoff'
      ];
      if (preset === 'agent') return core;
      if (preset === 'extension') return [...core, '/api/list_skills', '/api/read_skill'];
      if (preset === 'full') return toolCatalog.map(t => t.path);
      return core;
    }

    function applyPresetToCustomizer(preset) {
      const keys = new Set(getPresetKeys(preset));
      const checkboxes = document.querySelectorAll('.tool-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = keys.has(cb.dataset.path);
      });
      updateCustomizerCounter();
    }

    function toggleCategoryTools(cat) {
      const checkboxes = document.querySelectorAll('.tool-checkbox[data-cat="' + cat + '"]');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
      updateCustomizerCounter();
    }

    function selectAllCustomizerTools(state) {
      const checkboxes = document.querySelectorAll('.tool-checkbox');
      checkboxes.forEach(cb => { cb.checked = state; });
      updateCustomizerCounter();
    }

    function updateCustomizerCounter() {
      const checked = document.querySelectorAll('.tool-checkbox:checked');
      const count = checked.length;
      const counter = document.getElementById('customizer-ops-counter');
      if (!counter) return;

      if (count <= 30) {
        counter.innerHTML = count + ' / 30 Ops (ChatGPT Ready ✅)';
        counter.style.cssText = 'font-size: 12px; padding: 4px 10px; border-radius: 9999px; font-weight: 700; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);';
      } else {
        counter.innerHTML = count + ' / 30 Ops (⚠️ Exceeds ChatGPT 30 Ops Limit)';
        counter.style.cssText = 'font-size: 12px; padding: 4px 10px; border-radius: 9999px; font-weight: 700; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);';
      }
    }

    async function saveCustomizerProfile() {
      const checked = document.querySelectorAll('.tool-checkbox:checked');
      const customTools = Array.from(checked).map(cb => cb.dataset.path);
      customToolsList = customTools;
      currentOpenApiProfile = 'custom';

      const sel = document.getElementById('select-active-profile');
      if (sel) sel.value = 'custom';

      setOpenApiProfile('custom');
      updateActiveProfileBadge();
      closeProfileCustomizerModal();

      try {
        await fetch('/api/ui/profile/preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: 'custom', customTools })
        });
        alert('Saved Custom OpenAPI Profile (' + customTools.length + ' tools) successfully! 🎉');
      } catch (err) {
        alert('Failed to save profile: ' + err.message);
      }
    }

    function setOpenApiProfile(profile) {
      currentOpenApiProfile = profile;
      ['core', 'agent', 'extension', 'full'].forEach(p => {
        const btn = document.getElementById('btn-profile-' + p);
        if (btn) {
          if (p === profile) {
            btn.style.background = 'var(--primary)';
            btn.style.color = '#fff';
          } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-muted)';
          }
        }
      });
      const sel = document.getElementById('select-active-profile');
      if (sel) sel.value = profile;
      updateActiveProfileBadge();
      updateOpenApiDisplay();
    }

    function updateOpenApiDisplay() {
      const base = activePublicUrl ? (activePublicUrl.endsWith('/') ? activePublicUrl.slice(0, -1) : activePublicUrl) : location.origin;
      let url = base + '/openapi.json';
      let badgeText = '✅ ChatGPT Ready: ${opCounts.core} / 30 Ops Limit';
      let badgeClass = 'rgba(34, 197, 94, 0.15); color: #4ade80; border-color: rgba(34, 197, 94, 0.3)';
      let descText = '⭐ <strong>Core Dev Profile (${opCounts.core} Ops)</strong>: Workspace Health, Files CRUD, Grep Search, Git Status/Diff/Branch/Push, Bash Terminal, Snapshot, Safe Patch, and Skills System (list_skills & read_skill). (Recommended for ChatGPT!).';

      if (currentOpenApiProfile === 'agent') {
        url = base + '/openapi-agent.json';
        badgeText = '✅ ChatGPT Ready: ${opCounts.agent} / 30 Ops Limit';
        descText = '🤖 <strong>Agent Dev Profile (${opCounts.agent} Ops)</strong>: Core Dev tools + Codex Autonomous Agent execution capability.';
      } else if (currentOpenApiProfile === 'extension') {
        url = base + '/openapi-extension.json';
        badgeText = '✅ ChatGPT Ready: ${opCounts.extension} / 30 Ops Limit';
        descText = '🧩 <strong>Skills & Extension Profile (${opCounts.extension} Ops)</strong>: Core Dev tools + Agent Skills discovery and reading.';
      } else if (currentOpenApiProfile === 'full') {
        url = base + '/openapi-full.json';
        badgeText = '📦 Full Spec: ${opCounts.full} Ops (For MCP Clients)';
        badgeClass = 'rgba(168, 85, 247, 0.15); color: #c084fc; border-color: rgba(168, 85, 247, 0.3)';
        descText = '📦 <strong>Full MCP Spec (${opCounts.full} Ops)</strong>: Complete unconstrained specification with all tools (Note: exceeds ChatGPT 30 ops limit, best for Claude Code / CLI / Custom Clients).';
      } else if (currentOpenApiProfile === 'custom') {
        url = base + '/openapi-custom.json';
        const count = customToolsList.length || 0;
        const isOk = count <= 30;
        badgeText = isOk ? '✅ Custom: ' + count + ' / 30 Ops' : '⚠️ Custom: ' + count + ' / 30 Ops';
        badgeClass = isOk ? 'rgba(34, 197, 94, 0.15); color: #4ade80; border-color: rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.15); color: #ef4444; border-color: rgba(239, 68, 68, 0.3)';
        descText = '🎨 <strong>Custom Tailored Profile (' + count + ' Ops)</strong>: Tailored set of tools configured via Web Dashboard.';
      }

      const el = document.getElementById('openapi-url-display');
      if (el) el.innerText = url;

      const badgeEl = document.getElementById('profile-ops-badge');
      if (badgeEl) {
        badgeEl.innerText = badgeText;
        badgeEl.style.cssText = 'font-size: 12px; padding: 4px 10px; border-radius: 9999px; font-weight: 600; background: ' + badgeClass;
      }

      const descEl = document.getElementById('profile-desc-display');
      if (descEl) descEl.innerHTML = descText;
    }

    function copyText(text, successMsg) {
      if (!text) return;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
          alert(successMsg);
        }).catch(() => {
          fallbackCopyText(text, successMsg);
        });
      } else {
        fallbackCopyText(text, successMsg);
      }
    }

    function fallbackCopyText(text, successMsg) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        alert(successMsg);
      } catch (err) {
        prompt('Copy to clipboard: Ctrl+C, Enter', text);
      }
      document.body.removeChild(textArea);
    }

    function copyApiKey() {
      const key = document.getElementById('api-key-display')?.innerText;
      copyText(key, 'Copied Secret API Key!');
    }

    function copyOpenApiUrl() {
      const text = document.getElementById('openapi-url-display')?.innerText;
      copyText(text, 'Copied OpenAPI Schema URL: ' + text);
    }

    async function copyOpenApiJsonRaw() {
      try {
        const base = activePublicUrl ? (activePublicUrl.endsWith('/') ? activePublicUrl.slice(0, -1) : activePublicUrl) : location.origin;
        let suffix = '/openapi.json';
        if (currentOpenApiProfile === 'agent') suffix = '/openapi-agent.json';
        else if (currentOpenApiProfile === 'extension') suffix = '/openapi-extension.json';
        else if (currentOpenApiProfile === 'full') suffix = '/openapi-full.json';
        else if (currentOpenApiProfile === 'custom') suffix = '/openapi-custom.json';
        
        const res = await fetch(suffix);
        const json = await res.json();
        if (json.servers && json.servers.length) {
          json.servers[0].url = base;
        }
        const text = JSON.stringify(json, null, 2);
        copyText(text, 'Copied OpenAPI JSON Schema! Paste this text directly into the "Schema" box in ChatGPT Actions.');
      } catch (err) {
        alert('Failed to copy schema JSON: ' + err.message);
      }
    }

    function copyTunnelProfileUrl(profile) {
      setOpenApiProfile(profile);
      const base = activePublicUrl ? (activePublicUrl.endsWith('/') ? activePublicUrl.slice(0, -1) : activePublicUrl) : location.origin;
      let suffix = '/openapi.json';
      if (profile === 'agent') suffix = '/openapi-agent.json';
      else if (profile === 'extension') suffix = '/openapi-extension.json';
      else if (profile === 'full') suffix = '/openapi-full.json';
      const targetUrl = base + suffix;
      copyText(targetUrl, 'Copied ' + profile.toUpperCase() + ' OpenAPI Schema URL: ' + targetUrl);
    }

    function copySystemPrompt() {
      const text = document.getElementById('system-prompt-text')?.innerText;
      copyText(text, 'Copied System Prompt! You can now paste it into Custom GPT Instructions.');
    }

    function copyClaudeConfig() {
      const text = document.getElementById('claude-config-text')?.innerText;
      copyText(text, 'Copied Claude Config JSON!');
    }

    let openaiProfilesList = [];
    let activeOpenAiProfileId = null;
    let openAiTunnelProcessRunning = false;

    function getActiveOpenAiProfile() {
      return openaiProfilesList.find(profile => profile.id === activeOpenAiProfileId) || null;
    }

    function renderOpenAiProfilesDropdown() {
      const select = document.getElementById('select-openai-tunnel-profile');
      if (!select) return;
      select.innerHTML = '';
      for (const profile of openaiProfilesList) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name + (profile.tunnelId ? ' — ' + profile.tunnelId : '');
        option.selected = profile.id === activeOpenAiProfileId;
        select.appendChild(option);
      }
    }

    function populateOpenAiProfileFields() {
      const profile = getActiveOpenAiProfile();
      const nameInput = document.getElementById('openai-profile-name-input');
      const tunnelInput = document.getElementById('openai-profile-tunnel-id-input');
      const keyInput = document.getElementById('openai-profile-runtime-key-input');
      const keyState = document.getElementById('openai-runtime-key-configured');
      if (nameInput) nameInput.value = profile?.name || '';
      if (tunnelInput) tunnelInput.value = profile?.tunnelId || '';
      if (keyInput) keyInput.value = '';
      if (keyState) keyState.textContent = 'Runtime key: ' + (profile?.runtimeKeyConfigured ? 'Configured' : 'Not configured');
    }

    async function fetchOpenAiProfiles() {
      try {
        const res = await fetch('/api/ui/tunnel/openai/profiles');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        openaiProfilesList = Array.isArray(data.profiles) ? data.profiles : [];
        activeOpenAiProfileId = data.activeProfileId || null;
        renderOpenAiProfilesDropdown();
        populateOpenAiProfileFields();
      } catch (err) {
        console.error('Failed to fetch OpenAI tunnel profiles:', err);
      }
    }

    async function onOpenAiProfileChange(profileId) {
      if (!profileId || profileId === activeOpenAiProfileId) return;
      try {
        const res = await fetch('/api/ui/tunnel/openai/profiles/active', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await fetchOpenAiProfiles();
        await fetchOpenAiTunnelStatus();
      } catch (err) {
        alert('Failed to select OpenAI profile: ' + err.message);
        renderOpenAiProfilesDropdown();
      }
    }

    async function addOpenAiProfile() {
      const name = document.getElementById('openai-profile-name-input')?.value?.trim() || '';
      const tunnelId = document.getElementById('openai-profile-tunnel-id-input')?.value?.trim() || '';
      const runtimeKey = document.getElementById('openai-profile-runtime-key-input')?.value?.trim() || '';
      if (!name || !tunnelId || !runtimeKey) {
        alert('New profile requires name, Tunnel ID, and Runtime Key.');
        return;
      }
      try {
        const res = await fetch('/api/ui/tunnel/openai/profiles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, tunnelId, runtimeKey })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.profile?.id) {
          const selectRes = await fetch('/api/ui/tunnel/openai/profiles/active', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: data.profile.id })
          });
          const selectData = await selectRes.json();
          if (selectData.error) throw new Error(selectData.error);
        }
        await fetchOpenAiProfiles();
        await fetchOpenAiTunnelStatus();
      } catch (err) {
        alert('Failed to add OpenAI profile: ' + err.message);
      }
    }

    async function saveOpenAiProfile() {
      if (!activeOpenAiProfileId) return;
      const name = document.getElementById('openai-profile-name-input')?.value?.trim() || '';
      const tunnelId = document.getElementById('openai-profile-tunnel-id-input')?.value?.trim() || '';
      const runtimeKey = document.getElementById('openai-profile-runtime-key-input')?.value?.trim() || '';
      if (!name) return alert('Profile name is required.');
      try {
        const res = await fetch('/api/ui/tunnel/openai/profiles/' + encodeURIComponent(activeOpenAiProfileId), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, tunnelId, runtimeKey })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await fetchOpenAiProfiles();
        await fetchOpenAiTunnelStatus();
      } catch (err) {
        alert('Failed to save OpenAI profile: ' + err.message);
      }
    }

    async function deleteOpenAiProfile() {
      if (!activeOpenAiProfileId || !confirm('Delete the selected OpenAI tunnel profile?')) return;
      try {
        const res = await fetch('/api/ui/tunnel/openai/profiles/' + encodeURIComponent(activeOpenAiProfileId), { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await fetchOpenAiProfiles();
        await fetchOpenAiTunnelStatus();
      } catch (err) {
        alert('Failed to delete OpenAI profile: ' + err.message);
      }
    }

    async function fetchOpenAiTunnelStatus() {
      try {
        const res = await fetch('/api/ui/tunnel/openai/status');
        const status = await res.json();
        const badge = document.getElementById('openai-tunnel-status-pill');
        const btn = document.getElementById('btn-toggle-openai-tunnel');
        const select = document.getElementById('select-openai-tunnel-profile');
        const keyState = document.getElementById('openai-runtime-key-configured');
        const processRunning = typeof status.processRunning === 'boolean' ? status.processRunning : !!status.isConnected;
        const isReady = typeof status.isReady === 'boolean' ? status.isReady : !!status.isConnected;
        openAiTunnelProcessRunning = processRunning;
        if (select) select.disabled = processRunning;
        if (keyState) keyState.textContent = 'Runtime key: ' + (status.runtimeKeyConfigured ? 'Configured' : 'Not configured');

        if (badge && btn) {
          if (isReady) {
            badge.className = 'perm-badge perm-allowed';
            badge.textContent = '🟢 Active (PID: ' + (status.processPid || 'Running') + ')';
            btn.innerHTML = '⏹️ Stop Daemon';
            btn.style.background = '#ef4444';
            btn.style.color = '#fff';
          } else if (processRunning) {
            badge.className = 'perm-badge perm-denied';
            const phase = status.readiness === 'not_ready' ? '⚠️ Not ready' : '🟡 Connecting';
            const reason = status.error ? ': ' + String(status.error).slice(0, 160) : '';
            badge.textContent = phase + ' (PID: ' + (status.processPid || 'Running') + ')' + reason;
            btn.innerHTML = '⏹️ Stop Daemon';
            btn.style.background = '#ef4444';
            btn.style.color = '#fff';
          } else {
            badge.className = 'perm-badge perm-denied';
            badge.textContent = status.error ? '⚠️ Error: ' + String(status.error).slice(0, 160) : '⚪ Stopped';
            btn.innerHTML = '▶️ Start Daemon';
            btn.style.background = '#10b981';
            btn.style.color = '#04101e';
          }
        }
      } catch (err) {
        console.error('Failed to fetch OpenAI tunnel status:', err);
      }
    }

    async function saveOpenAiTunnelConfig() {
      const tunnelId = document.getElementById('openai-profile-tunnel-id-input')?.value?.trim() || '';
      const runtimeKey = document.getElementById('openai-profile-runtime-key-input')?.value?.trim() || '';
      try {
        const res = await fetch('/api/ui/tunnel/openai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tunnelId, runtimeKey })
        });
        const data = await res.json();
        if (data.error) {
          alert('Failed to save config: ' + data.error);
        } else {
          await fetchOpenAiProfiles();
          await fetchOpenAiTunnelStatus();
        }
      } catch (err) {
        alert('Error saving config: ' + err.message);
      }
    }

    async function toggleOpenAiTunnel() {
      const isRunning = openAiTunnelProcessRunning;
      const endpoint = isRunning ? '/api/ui/tunnel/openai/stop' : '/api/ui/tunnel/openai/start';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isRunning ? {} : { profileId: activeOpenAiProfileId })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await fetchOpenAiProfiles();
        await fetchOpenAiTunnelStatus();
      } catch (err) {
        alert('Tunnel daemon error: ' + err.message);
      }
    }

    function switchTab(tab, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('[id^="tab-"]').forEach(d => d.style.display = 'none');
      const targetTab = document.getElementById('tab-' + tab);
      if (targetTab) targetTab.style.display = 'block';
      if (btn && btn.classList) {
        btn.classList.add('active');
      } else {
        const buttons = document.querySelectorAll('.tab-btn');
        for (const b of buttons) {
          if (b.getAttribute('onclick')?.includes(tab)) {
            b.classList.add('active');
            break;
          }
        }
      }
      if (tab === 'logs') fetchLogs();
    }

    async function fetchProjects() {
      try {
        const res = await fetch('/api/ui/projects');
        const data = await res.json();
        projectsData = data.projects || [];
        if (data.apiKey) {
          document.getElementById('api-key-display').innerText = data.apiKey;
        }
        renderProjects(data);
        fetchOpenAiProfiles();
        fetchOpenAiTunnelStatus();
      } catch (err) {
        console.error(err);
      }
    }

    function renderProjects(data) {
      const grid = document.getElementById('projects-grid');
      
      if (!data.projects || data.projects.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 32px; text-align: center; color: var(--text-muted); background: var(--card); border-radius: 12px; border: 1px dashed var(--border);">No projects registered yet. Click "+ Add New Project" to add your first workspace.</div>';
        return;
      }

      grid.innerHTML = data.projects.map(p => \`
        <div class="project-card">
          <div class="card-top">
            <div class="card-title">
              <h3>\${p.name}</h3>
              
            </div>
            <div class="card-path">\${p.path}</div>
            <div class="card-desc">\${p.description || 'No description provided.'}</div>
            \${p.availableSkills && p.availableSkills.length > 0 ? '<div class="perm-badges" style="margin-top: 10px;"><span class="perm-badge perm-allowed" style="background:rgba(34,197,94,0.15);color:#4ade80;border-color:rgba(34,197,94,0.3);">🪄 ' + p.availableSkills.length + ' Skills</span></div>' : ''}
          </div>
          
          <div class="card-actions">
            
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="openEditModal('\${p.id}')">⚙️ Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteProject('\${p.id}', '\${p.name}')">🗑️</button>
            </div>
          </div>
        </div>
      \`).join('');
    }

    async function deleteProject(id, name) {
      if (!confirm(\`ต้องการลบโปรเจกต์ "\${name}" ออกจาก Registry ใช่หรือไม่?\\n(ไฟล์จริงในคอมพิวเตอร์ของคุณจะไม่ถูกลบ)\`)) return;
      await fetch('/api/ui/projects/' + id, { method: 'DELETE' });
      fetchProjects();
    }

    function openAddModal() {
      document.getElementById('modal-title').innerText = 'Add New Project';
      document.getElementById('form-id').value = '';
      document.getElementById('form-name').value = '';
      document.getElementById('form-path').value = '';
      document.getElementById('form-desc').value = '';
      document.getElementById('project-modal').style.display = 'flex';
    }

    function openEditModal(id) {
      const p = projectsData.find(x => x.id === id);
      if (!p) return;
      document.getElementById('modal-title').innerText = 'Edit Project Details';
      document.getElementById('form-id').value = p.id;
      document.getElementById('form-name').value = p.name;
      document.getElementById('form-path').value = p.path;
      document.getElementById('form-desc').value = p.description || '';
      document.getElementById('project-modal').style.display = 'flex';
    }

    function closeModal() {
      document.getElementById('project-modal').style.display = 'none';
    }

    async function saveProject(e) {
      e.preventDefault();
      const id = document.getElementById('form-id').value;
      const name = document.getElementById('form-name').value?.trim();
      const path = document.getElementById('form-path').value?.trim();
      const description = document.getElementById('form-desc').value?.trim();

      if (!name || !path) {
        alert('Please fill in both Project Name and Root Path.');
        return;
      }

      try {
        if (id) {
          const res = await fetch('/api/ui/projects/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, path, description }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
        } else {
          const res = await fetch('/api/ui/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, path, description }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
        }
        closeModal();
        fetchProjects();
      } catch (err) {
        alert('Failed to save project: ' + err.message);
      }
    }

    async function fetchLogs() {
      try {
        const res = await fetch('/logs?json=true');
        const payload = await res.json();
        const logs = Array.isArray(payload) ? payload : payload.events || [];
        const tbody = document.getElementById('logs-table-body');
        if (!logs || logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--text-muted);">ยังไม่มีประวัติคำสั่ง</td></tr>';
          return;
        }
        tbody.innerHTML = logs.map(l => \`
          <tr>
            <td style="color:#94a3b8; font-family:monospace;">\${l.timestamp}</td>
            <td style="font-weight:700; color:\${l.status === 'success' ? '#4ade80' : '#f87171'};">\${l.action}</td>
            <td style="color:#93c5fd;"><pre>\${JSON.stringify(l.params, null, 2)}</pre></td>
            <td style="color:#cbd5e1;">\${l.resultSummary || l.error || '-'}</td>
            <td style="color:#fbbf24; font-family:monospace;">\${l.durationMs}ms</td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error(err);
      }
    }

    let currentBrowserData = { currentPath: '', parentPath: null };

    function openFolderBrowser() {
      const current = document.getElementById('form-path').value.trim();
      document.getElementById('browser-modal').style.display = 'flex';
      browseFolder(current || '');
    }

    function closeFolderBrowser() {
      document.getElementById('browser-modal').style.display = 'none';
    }

    async function browseFolder(targetPath) {
      const listEl = document.getElementById('browser-list');
      const errorEl = document.getElementById('browser-error');
      errorEl.style.display = 'none';
      listEl.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted);">Loading folders...</div>';

      try {
        const res = await fetch('/api/ui/browse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPath })
        });
        const data = await res.json();
        currentBrowserData = data;
        document.getElementById('browser-current-path').value = data.currentPath;
        document.getElementById('browser-up-btn').disabled = !data.parentPath;

        if (data.error) {
          errorEl.innerText = data.error;
          errorEl.style.display = 'block';
        }

        if (!data.directories || data.directories.length === 0) {
          listEl.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted);">(No subdirectories found)</div>';
          return;
        }

        listEl.innerHTML = data.directories.map(d => \`
          <div class="dir-item" data-path="\${encodeURIComponent(d.path)}" style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:14px; font-family:monospace;" onmouseover="this.style.background='#18233c'" onmouseout="this.style.background='transparent'">
            <span>📁</span>
            <span style="flex:1;">\${d.name}</span>
          </div>
        \`).join('');

        listEl.onclick = (e) => {
          const item = e.target.closest('.dir-item');
          if (item) {
            const path = decodeURIComponent(item.dataset.path);
            browseFolder(path);
          }
        };
      } catch (err) {
        errorEl.innerText = err.message;
        errorEl.style.display = 'block';
        listEl.innerHTML = '';
      }
    }

    function navigateBrowserUp() {
      if (currentBrowserData.parentPath) {
        browseFolder(currentBrowserData.parentPath);
      }
    }

    function selectCurrentFolder() {
      if (currentBrowserData.currentPath) {
        document.getElementById('form-path').value = currentBrowserData.currentPath;
        closeFolderBrowser();
      }
    }

    async function fetchNgrokStatus() {
      try {
        const res = await fetch('/api/ui/ngrok/status');
        const data = await res.json();
        const pill = document.getElementById('ngrok-status-pill');
        const urlDisplay = document.getElementById('ngrok-url-display');
        const tokenInput = document.getElementById('ngrok-token-input');
        const chips = document.getElementById('ngrok-profile-chips');
        
        if (data.authtoken && tokenInput && !tokenInput.value) {
          tokenInput.value = data.authtoken;
        }

        if (data.isConnected && data.url) {
          pill.className = 'perm-badge perm-allowed';
          pill.innerHTML = '🟢 Tunnel Active';
          urlDisplay.innerHTML = 'Public URL: <a href="' + data.url + '" target="_blank" style="color:#38bdf8; text-decoration:underline; font-weight:600;">' + data.url + '</a>';
          if (chips) chips.style.display = 'block';
          activePublicUrl = data.url;
          updateOpenApiDisplay();
          document.getElementById('btn-start-ngrok').disabled = true;
          document.getElementById('btn-start-ngrok').style.opacity = '0.5';
          document.getElementById('btn-stop-ngrok').disabled = false;
          document.getElementById('btn-stop-ngrok').style.opacity = '1';
        } else {
          pill.className = 'perm-badge perm-denied';
          pill.innerHTML = '🔴 Tunnel Disconnected';
          urlDisplay.innerHTML = 'Tunnel is currently stopped.';
          if (chips) chips.style.display = 'none';
          if (activePublicUrl === data.url) {
            activePublicUrl = '';
            updateOpenApiDisplay();
          }
          document.getElementById('btn-start-ngrok').disabled = false;
          document.getElementById('btn-start-ngrok').style.opacity = '1';
          document.getElementById('btn-stop-ngrok').disabled = true;
          document.getElementById('btn-stop-ngrok').style.opacity = '0.5';
        }
      } catch (err) {
        console.error('Failed to fetch ngrok status:', err);
      }
    }

    function toggleTokenVisibility(type) {
      let inputId = 'ngrok-token-input';
      if (type === 'openai') inputId = 'openai-runtime-key-input';
      const input = document.getElementById(inputId);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    }

    async function fetchTunnelPreference() {
      try {
        const res = await fetch('/api/ui/tunnel/preference');
        const data = await res.json();
        const radios = document.getElementsByName('auto-tunnel-choice');
        const selected = data.autoStart ? (data.preferredTunnel || 'ngrok') : 'none';
        for (const r of radios) {
          r.checked = (r.value === selected);
        }
      } catch (err) {
        console.error('Failed to fetch tunnel preference:', err);
      }
    }

    async function updateTunnelPreference(choice) {
      try {
        const autoStart = choice !== 'none';
        const preferredTunnel = choice;
        await fetch('/api/ui/tunnel/preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferredTunnel, autoStart })
        });
        await fetchTunnelPreference();
      } catch (err) {
        console.error('Failed to save tunnel preference:', err);
      }
    }

    let ngrokProfilesList = [];
    let activeNgrokProfileId = 'default';

    async function fetchNgrokProfiles() {
      try {
        const res = await fetch('/api/ui/ngrok/profiles');
        const data = await res.json();
        ngrokProfilesList = data.profiles || [];
        activeNgrokProfileId = data.activeProfileId || 'default';
        renderNgrokProfilesDropdown();
        renderNgrokProfilesListModal();
      } catch (err) {
        console.error('Failed to fetch Ngrok profiles:', err);
      }
    }

    function renderNgrokProfilesDropdown() {
      const select = document.getElementById('select-ngrok-account-profile');
      const domainTag = document.getElementById('ngrok-active-domain-tag');
      if (!select) return;

      select.innerHTML = ngrokProfilesList.map(p => {
        const domainStr = p.domain ? ' (' + p.domain + ')' : ' (Auto URL)';
        const tokenMask = p.authtoken ? ' • ' + p.authtoken.slice(0, 4) + '...' : ' (No token)';
        return '<option value="' + p.id + '" ' + (p.id === activeNgrokProfileId ? 'selected' : '') + '>' + p.name + domainStr + tokenMask + '</option>';
      }).join('');

      const active = ngrokProfilesList.find(p => p.id === activeNgrokProfileId) || ngrokProfilesList[0];
      if (domainTag) {
        domainTag.innerText = active && active.domain ? active.domain : 'Dynamic URL';
      }
    }

    async function onNgrokAccountProfileChange(profileId) {
      activeNgrokProfileId = profileId;
      try {
        await fetch('/api/ui/ngrok/profiles/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId })
        });
        const active = ngrokProfilesList.find(p => p.id === profileId);
        const domainTag = document.getElementById('ngrok-active-domain-tag');
        if (domainTag && active) {
          domainTag.innerText = active.domain || 'Dynamic URL';
        }
      } catch (err) {
        console.error('Failed to switch Ngrok profile:', err);
      }
    }

    function openNgrokProfilesModal() {
      const modal = document.getElementById('modal-ngrok-accounts');
      renderNgrokProfilesListModal();
      resetNgrokProfileForm();
      if (modal) modal.style.display = 'flex';
    }

    function closeNgrokProfilesModal() {
      const modal = document.getElementById('modal-ngrok-accounts');
      if (modal) modal.style.display = 'none';
      fetchNgrokProfiles();
    }

    function renderNgrokProfilesListModal() {
      const listEl = document.getElementById('ngrok-profiles-list');
      if (!listEl) return;

      if (!ngrokProfilesList.length) {
        listEl.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 13px;">No Ngrok profiles configured.</div>';
        return;
      }

      listEl.innerHTML = ngrokProfilesList.map(p => {
        const isActive = p.id === activeNgrokProfileId;
        return \`
          <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid \${isActive ? '#6366f1' : 'var(--border)'}; border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                <strong style="color: #fff; font-size: 13px;">\${p.name}</strong>
                \${isActive ? '<span style="font-size: 10px; background: rgba(99, 102, 241, 0.2); color: #a78bfa; border: 1px solid #6366f1; padding: 1px 6px; border-radius: 4px; font-weight: 600;">ACTIVE</span>' : ''}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                Domain: <span style="color: #38bdf8;">\${p.domain || '(Auto dynamic URL)'}</span> | Key: \${p.authtoken ? p.authtoken.slice(0, 6) + '...' + p.authtoken.slice(-4) : '(None)'}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              \${!isActive ? \`<button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 6px;" onclick="setNgrokProfileActiveFromModal('\${p.id}')">Use</button>\` : ''}
              <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 6px;" onclick="editNgrokProfileForm('\${p.id}')">✏️</button>
              \${ngrokProfilesList.length > 1 ? \`<button type="button" class="btn btn-danger btn-sm" style="font-size: 11px; padding: 2px 6px;" onclick="deleteNgrokProfile('\${p.id}')">🗑️</button>\` : ''}
            </div>
          </div>
        \`;
      }).join('');
    }

    async function setNgrokProfileActiveFromModal(id) {
      await onNgrokAccountProfileChange(id);
      renderNgrokProfilesDropdown();
      renderNgrokProfilesListModal();
    }

    function showAddNgrokProfileForm() {
      resetNgrokProfileForm();
      document.getElementById('ngrok-form-title').innerText = '➕ Add New Ngrok Profile';
      document.getElementById('ngrok-form-name').focus();
    }

    function resetNgrokProfileForm() {
      document.getElementById('ngrok-form-id').value = '';
      document.getElementById('ngrok-form-name').value = '';
      document.getElementById('ngrok-form-token').value = '';
      document.getElementById('ngrok-form-domain').value = '';
      document.getElementById('ngrok-form-desc').value = '';
      document.getElementById('ngrok-form-title').innerText = '➕ Add New Ngrok Profile';
    }

    function editNgrokProfileForm(id) {
      const prof = ngrokProfilesList.find(p => p.id === id);
      if (!prof) return;
      document.getElementById('ngrok-form-id').value = prof.id;
      document.getElementById('ngrok-form-name').value = prof.name;
      document.getElementById('ngrok-form-token').value = prof.authtoken || '';
      document.getElementById('ngrok-form-domain').value = prof.domain || '';
      document.getElementById('ngrok-form-desc').value = prof.description || '';
      document.getElementById('ngrok-form-title').innerText = '✏️ Edit Profile: ' + prof.name;
      document.getElementById('ngrok-form-name').focus();
    }

    async function saveNgrokProfileForm(e) {
      e.preventDefault();
      const id = document.getElementById('ngrok-form-id').value.trim();
      const name = document.getElementById('ngrok-form-name').value.trim();
      const authtoken = document.getElementById('ngrok-form-token').value.trim();
      const domain = document.getElementById('ngrok-form-domain').value.trim();
      const description = document.getElementById('ngrok-form-desc').value.trim();

      try {
        if (id) {
          // Update
          await fetch('/api/ui/ngrok/profiles/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, authtoken, domain, description })
          });
        } else {
          // Add
          await fetch('/api/ui/ngrok/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, authtoken, domain, description })
          });
        }
        await fetchNgrokProfiles();
        resetNgrokProfileForm();
      } catch (err) {
        alert('Error saving Ngrok profile: ' + err.message);
      }
    }

    async function deleteNgrokProfile(id) {
      if (!confirm('Are you sure you want to delete this Ngrok profile?')) return;
      try {
        await fetch('/api/ui/ngrok/profiles/' + encodeURIComponent(id), { method: 'DELETE' });
        await fetchNgrokProfiles();
      } catch (err) {
        alert('Failed to delete Ngrok profile: ' + err.message);
      }
    }

    function toggleFormTokenVisibility() {
      const input = document.getElementById('ngrok-form-token');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    }

    async function startNgrokTunnel() {
      const btn = document.getElementById('btn-start-ngrok');
      btn.innerHTML = '⏳ Starting...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/ui/ngrok/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: activeNgrokProfileId })
        });
        const data = await res.json();
        if (data.error) {
          alert('Failed to start Ngrok: ' + data.error);
        } else {
          fetchNgrokStatus();
        }
      } catch (err) {
        alert('Error starting Ngrok: ' + err.message);
      } finally {
        btn.innerHTML = '▶️ Start';
        btn.disabled = false;
      }
    }

    async function stopNgrokTunnel() {
      try {
        const res = await fetch('/api/ui/ngrok/stop', { method: 'POST' });
        const data = await res.json();
        if (data.error) {
          alert('Failed to stop Ngrok: ' + data.error);
        } else {
          fetchNgrokStatus();
        }
      } catch (err) {
        alert('Error stopping Ngrok: ' + err.message);
      }
    }

    async function fetchAgentStatus() {
      try {
        const res = await fetch('/api/ui/agent_status');
        const data = await res.json();
        const cur = data.currentStatus || {};
        const stats = data.stats || {};

        // Update Header Status Pill
        const avatar = document.getElementById('hub-avatar');
        const icon = document.getElementById('hub-icon');
        const label = document.getElementById('hub-label');
        const headerStatus = document.getElementById('header-agent-status');

        if (label) {
          label.innerText = cur.label || 'Standby & Ready for AI Instructions';
        }

        if (icon && avatar) {
          icon.className = 'hub-avatar-icon';
          if (cur.category === 'build') {
            avatar.className = 'hub-avatar-wrapper active-build';
            icon.innerHTML = '⚙️';
            icon.classList.add('anim-spin');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(251, 191, 36, 0.6)';
              headerStatus.style.boxShadow = '0 0 20px rgba(251, 191, 36, 0.3)';
            }
          } else if (cur.category === 'write') {
            avatar.className = 'hub-avatar-wrapper active-write';
            icon.innerHTML = '✍️';
            icon.classList.add('anim-pulse');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(52, 211, 153, 0.6)';
              headerStatus.style.boxShadow = '0 0 20px rgba(52, 211, 153, 0.3)';
            }
          } else if (cur.category === 'read') {
            avatar.className = 'hub-avatar-wrapper active-read';
            icon.innerHTML = '📖';
            icon.classList.add('anim-pulse');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(56, 189, 248, 0.6)';
              headerStatus.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.3)';
            }
          } else if (cur.category === 'test') {
            avatar.className = 'hub-avatar-wrapper active-test';
            icon.innerHTML = '🧪';
            icon.classList.add('anim-pulse');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(167, 139, 250, 0.6)';
              headerStatus.style.boxShadow = '0 0 20px rgba(167, 139, 250, 0.3)';
            }
          } else if (cur.category === 'git') {
            avatar.className = 'hub-avatar-wrapper active-git';
            icon.innerHTML = '🚀';
            icon.classList.add('anim-float');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(129, 140, 248, 0.6)';
              headerStatus.style.boxShadow = '0 0 20px rgba(129, 140, 248, 0.3)';
            }
          } else if (cur.category === 'command') {
            avatar.className = 'hub-avatar-wrapper active-command';
            icon.innerHTML = '⚡';
            icon.classList.add('anim-pulse');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(6, 182, 212, 0.6)';
              headerStatus.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.3)';
            }
          } else {
            avatar.className = 'hub-avatar-wrapper active-idle';
            icon.innerHTML = '💤';
            icon.classList.add('anim-breath');
            if (headerStatus) {
              headerStatus.style.borderColor = 'rgba(99, 102, 241, 0.45)';
              headerStatus.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3), 0 0 12px rgba(99, 102, 241, 0.2)';
            }
          }
        }

        // Update Stat Counters
        if (document.getElementById('stat-read')) document.getElementById('stat-read').innerText = stats.filesRead || 0;
        if (document.getElementById('stat-write')) document.getElementById('stat-write').innerText = stats.filesWritten || 0;
        if (document.getElementById('stat-build')) document.getElementById('stat-build').innerText = stats.buildsCount || 0;
        if (document.getElementById('stat-test')) document.getElementById('stat-test').innerText = stats.testsCount || 0;
        if (document.getElementById('stat-git')) document.getElementById('stat-git').innerText = stats.gitOpsCount || 0;
        if (document.getElementById('stat-cmd')) document.getElementById('stat-cmd').innerText = stats.commandsCount || 0;
      } catch (err) {
        console.error('Failed to fetch agent status:', err);
      }
    }

    async function shutdownMcpServer() {
      if (!confirm('Are you sure you want to stop and quit the Core MCP Server process?')) return;
      try {
        await fetch('/api/ui/shutdown', { method: 'POST' });
        document.body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#f8fafc;font-family:sans-serif;text-align:center;padding:20px;"><div style="width:64px;height:64px;border-radius:20px;background:rgba(239,68,68,0.2);display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:20px;border:1px solid rgba(239,68,68,0.4);color:#ef4444;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg></div><h2 style="font-size:24px;margin-bottom:8px;">Core MCP Server Stopped</h2><p style="color:#94a3b8;max-width:400px;line-height:1.5;">The Node.js server and all tunnel services have been terminated cleanly. You may now close this window.</p></div>';
        setTimeout(function() { window.close(); }, 1500);
      } catch (err) {
        alert('Server shutdown signal sent.');
        window.close();
      }
    }

    async function fetchGlobalPermissions() {
      try {
        const res = await fetch('/api/ui/permissions/global');
        const perms = await res.json();
        document.getElementById('gperm-read').checked = perms.canRead !== false;
        document.getElementById('gperm-write').checked = perms.canWrite !== false;
        document.getElementById('gperm-cmd').checked = perms.canRunCommand !== false;
        document.getElementById('gperm-skills').checked = perms.canUseSkills !== false;
        document.getElementById('gperm-handoff').checked = perms.canUseHandoff !== false;
      } catch (err) {
        console.error('Failed to fetch global permissions:', err);
      }
    }

    async function toggleGlobalPerm(key, val) {
      try {
        await fetch('/api/ui/permissions/global', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: val })
        });
        await fetchGlobalPermissions();
      } catch (err) {
        alert('Failed to update global permission: ' + err.message);
      }
    }

    fetchGlobalPermissions();
    fetchProjects();
    fetchTunnelPreference();
    fetchProfilePreference();
    fetchNgrokProfiles();
    fetchNgrokStatus();
    fetchAgentStatus();
    setInterval(() => {
      fetchAgentStatus();
      fetchNgrokStatus();
      fetchOpenAiTunnelStatus();
      if (document.getElementById('tab-logs').style.display !== 'none') {
        fetchLogs();
      }
    }, 2000);
  </script>
</body>
</html>`;
}
