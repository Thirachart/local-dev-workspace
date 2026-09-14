import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import ngrok from '@ngrok/ngrok';
import { FileService } from '../services/fileService.js';
import { SearchService } from '../services/searchService.js';
import { ProcessService } from '../services/processService.js';
import { GitService } from '../services/gitService.js';
import { ProjectService } from '../services/projectService.js';
import { AuthService, resolveStartupTunnel } from '../services/authService.js';
import { NgrokService } from '../services/ngrokService.js';
import { OpenAiTunnelService } from '../services/openaiTunnelService.js';
import { MemoryService } from '../services/memoryService.js';
import { PatchService, serializePatchError } from '../services/patchService.js';
import { DiagnosticService } from '../services/diagnosticService.js';
import { SnapshotService } from '../services/snapshotService.js';
import { SymbolService } from '../services/symbolService.js';
import { GitWorkflowService } from '../services/gitWorkflowService.js';
import { DiagnosticParserService } from '../services/diagnosticParserService.js';
import { TestRunnerService } from '../services/testRunnerService.js';
import { WorkspaceHealthService } from '../services/workspaceHealthService.js';
import { Logger } from '../utils/logger.js';

export function getOpenAiTunnelStartRequest(body: unknown): { profileId?: string } {
  const profileId = (body as { profileId?: unknown } | null)?.profileId;
  if (typeof profileId !== 'string' || !profileId.trim()) return {};
  return { profileId: profileId.trim() };
}

export function getProjectDiagnosticsRequest(body: unknown): {
  task: 'typecheck' | 'lint' | 'test' | 'build' | 'all';
  options: { customCwd?: string; project?: string; command?: string };
} {
  const { task, cwd, project, command } = (body || {}) as Record<string, unknown>;
  return {
    task: (task || 'all') as 'typecheck' | 'lint' | 'test' | 'build' | 'all',
    options: {
      customCwd: typeof cwd === 'string' ? cwd : undefined,
      project: typeof project === 'string' ? project : undefined,
      command: typeof command === 'string' ? command : undefined,
    },
  };
}
import { renderDashboardHtml } from '../ui/dashboard.js';
import { renderAppPanelHtml } from '../ui/appPanel.js';
import { getOpenApiSpec, getToolCatalog, getProfileOpCounts } from './openapi.js';
import { SelfHostedProvider } from '../tunnel/providers/selfHostedProvider.js';
import { parseTunnelFrame, createErrorFrame } from '../tunnel/protocol/validation.js';

export function shouldServeSse(req: {
  headers?: { accept?: string | string[] };
  query?: { [key: string]: unknown };
}): boolean {
  const accept = Array.isArray(req.headers?.accept) ? req.headers.accept.join(',') : req.headers?.accept || '';
  return accept.includes('text/event-stream') || req.query?.transport === 'sse';
}

export function configureSseResponse(res: { setHeader(name: string, value: string): void }): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

export function isJsonRpcNotification(message: unknown): boolean {
  return !!message && typeof message === 'object' && !Object.prototype.hasOwnProperty.call(message, 'id');
}

export interface OAuthDiscoveryConfig {
  resourceUrl: string;
  authorizationServerUrl: string;
}

function normalizeHttpsUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function resolveOAuthDiscoveryConfig(
  env: Record<string, string | undefined> = process.env
): OAuthDiscoveryConfig | null {
  const authorizationServerUrl = normalizeHttpsUrl(
    env.MCP_OAUTH_AUTHORIZATION_SERVER_URL || env.MCP_OAUTH_PUBLIC_BASE_URL
  );
  if (!authorizationServerUrl) return null;

  const configuredResourceUrl = env.MCP_OAUTH_RESOURCE_URL?.trim();
  const resourceUrl = configuredResourceUrl
    ? normalizeHttpsUrl(configuredResourceUrl)
    : authorizationServerUrl;
  if (!resourceUrl) return null;

  return { resourceUrl, authorizationServerUrl };
}

export async function forwardSsePostMessage<TReq, TRes>(
  transport: { handlePostMessage(req: TReq, res: TRes, parsedBody?: unknown): Promise<void> },
  req: TReq & { body?: unknown },
  res: TRes
): Promise<void> {
  await transport.handlePostMessage(req, res, req.body);
}

export function startSseTransport(
  server: McpServer,
  services: {
    fileService: FileService;
    searchService: SearchService;
    processService: ProcessService;
    gitService: GitService;
    projectService: ProjectService;
    authService: AuthService;
    ngrokService: NgrokService;
    openAiTunnelService?: OpenAiTunnelService;
    memoryService: MemoryService;
    patchService?: PatchService;
    diagnosticService?: DiagnosticService;
    snapshotService?: SnapshotService;
    symbolService?: SymbolService;
    gitWorkflowService?: GitWorkflowService;
    diagnosticParserService?: DiagnosticParserService;
    logger?: Logger;
  },
  port: number = 4100,
  host: string = 'localhost',
  ngrokToken?: string
): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    const logger = services.logger || new Logger(process.cwd());
    const transports = new Map<string, SSEServerTransport>();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    // Ensure any lingering tunnel-client binary is killed on startup
    try {
      if (process.platform === 'win32') {
        execSync('taskkill /F /IM tunnel-client.exe /T', { stdio: 'ignore' });
      } else {
        execSync('pkill -f tunnel-client', { stdio: 'ignore' });
      }
    } catch {}

    // --- LOCAL-ONLY ACCESS CONTROL FOR WEB DASHBOARD & UI ---
    function isLocalRequest(req: express.Request): boolean {
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

    const requireLocalAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!isLocalRequest(req)) {
        logger.logAction({
          action: 'blocked_public_ui_access',
          params: { path: req.path, host: req.get('host'), ip: req.ip },
          status: 'error',
          durationMs: 0,
          error: `[403 FORBIDDEN] Attempted access to UI endpoint "${req.path}" via public tunnel (${req.get('host')}). Access restricted to localhost.`,
        });
        if (req.accepts('html')) {
          return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head><title>403 Forbidden - Localhost Only</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #161b22; border: 1px solid #30363d; padding: 36px; border-radius: 12px; max-width: 480px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
              h1 { color: #f85149; margin: 0 0 16px 0; font-size: 24px; display: flex; align-items: center; justify-content: center; gap: 8px; }
              p { color: #8b949e; line-height: 1.6; font-size: 14px; margin: 0 0 16px 0; }
              .badge { display: inline-block; background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px; font-family: monospace; font-size: 13px; color: #58a6ff; }
            </style>
            </head>
            <body>
              <div class="card">
                <h1>🔒 Access Denied</h1>
                <p>The <b>Chat Dev Web Dashboard</b> and UI APIs are restricted to <b>localhost only</b> for your computer's security.</p>
                <div class="badge">http://localhost:${port}</div>
              </div>
            </body>
            </html>
          `);
        }
        return res.status(403).json({
          error: 'Forbidden: Web Dashboard and UI APIs are strictly restricted to localhost (127.0.0.1) for security reasons.',
        });
      }
      next();
    };

    // --- USER WEB DASHBOARD (LOCAL ONLY) ---
    app.get(['/', '/dashboard', '/logs'], requireLocalAccess, (req, res) => {
      if (req.path === '/' && shouldServeSse(req)) {
        return handleSseConnection(req, res);
      }
      if (req.query.json === 'true') {
        return res.json(logger.queryActivityLogs({
          cursor: typeof req.query.cursor === 'string' ? Number(req.query.cursor) : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
          action: typeof req.query.action === 'string' ? req.query.action : undefined,
          project: typeof req.query.project === 'string' ? req.query.project : undefined,
          status: req.query.status === 'success' || req.query.status === 'error' ? req.query.status : undefined,
          source: req.query.source === 'mcp' || req.query.source === 'rest' ? req.query.source : undefined,
        }));
      }
      res.send(renderDashboardHtml(port));
    });
    app.get('/api/ui/logs', requireLocalAccess, (req, res) => {
      res.json(logger.queryActivityLogs({ limit: 100 }));
    });
    app.post('/api/ui/shutdown', requireLocalAccess, async (req, res) => {
      res.json({ success: true, message: 'Core MCP Server is shutting down cleanly...' });
      setTimeout(() => {
        logger.info('Received shutdown request from UI. Exiting process...');
        process.exit(0);
      }, 300);
    });
    app.post('/api/ui/restart', requireLocalAccess, async (req, res) => {
      res.json({ success: true, message: 'Core MCP Server is restarting...' });
      setTimeout(() => {
        logger.info('Received restart request from UI. Exiting process for supervisor restart...');
        process.exit(0);
      }, 300);
    });

    app.get('/api/ui/permissions/global', requireLocalAccess, (req, res) => {
      res.json(services.projectService.getGlobalPermissions());
    });

    app.post('/api/ui/permissions/global', requireLocalAccess, (req, res) => {
      const updated = services.projectService.updateGlobalPermissions(req.body);
      res.json(updated);
    });
    app.use('/api/ui', requireLocalAccess);

    // --- UI API ENDPOINTS (FOR HUMAN USER DASHBOARD) ---
    app.post('/api/ui/browse', async (req, res) => {
      try {
        const { targetPath } = req.body || {};
        const dirPath = targetPath && targetPath.trim() ? path.resolve(targetPath.trim()) : os.homedir();
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const directories = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => ({
            name: entry.name,
            path: path.join(dirPath, entry.name),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        const parentPath = path.dirname(dirPath) !== dirPath ? path.dirname(dirPath) : null;
        res.json({
          currentPath: dirPath,
          parentPath,
          directories,
        });
      } catch (err: any) {
        const targetQuery = (req.query.path as string) || '';
        const fallbackPath = targetQuery && targetQuery.trim() ? path.resolve(targetQuery.trim()) : os.homedir();
        const parentPath = path.dirname(fallbackPath) !== fallbackPath ? path.dirname(fallbackPath) : null;
        res.status(200).json({
          error: err.message,
          currentPath: fallbackPath,
          parentPath,
          directories: [],
        });
      }
    });

    app.get('/api/ui/ngrok/status', (req, res) => {
      res.json(services.ngrokService.getStatus());
    });

    app.get('/api/ui/ngrok/profiles', (req, res) => {
      res.json(services.ngrokService.getProfiles());
    });

    app.post('/api/ui/ngrok/profiles/active', async (req, res) => {
      try {
        const { profileId } = req.body || {};
        const profile = await services.ngrokService.setActiveProfile(profileId);
        res.json({ success: true, profile });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/ngrok/profiles', async (req, res) => {
      try {
        const { name, authtoken, domain, description } = req.body || {};
        const profile = await services.ngrokService.addProfile({ name, authtoken, domain, description });
        res.json({ success: true, profile });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.put('/api/ui/ngrok/profiles/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const profile = await services.ngrokService.updateProfile(id, req.body || {});
        res.json({ success: true, profile });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.delete('/api/ui/ngrok/profiles/:id', async (req, res) => {
      try {
        const { id } = req.params;
        await services.ngrokService.deleteProfile(id);
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/ngrok/start', async (req, res) => {
      try {
        const { token, profileId } = req.body || {};
        const status = await services.ngrokService.start(port, profileId || token);
        res.json({ success: true, ...status });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/ngrok/stop', async (req, res) => {
      try {
        const status = await services.ngrokService.stop();
        res.json({ success: true, ...status });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/ngrok/token', async (req, res) => {
      try {
        const { token } = req.body || {};
        await services.ngrokService.saveToken(token || '');
        res.json({ success: true, authtoken: services.ngrokService.getAuthtoken() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // --- TUNNEL PREFERENCE & PERSISTENCE ENDPOINTS ---
    app.get('/api/ui/tunnel/preference', (req, res) => {
      res.json(services.authService.getTunnelPreference());
    });

    app.post('/api/ui/tunnel/preference', (req, res) => {
      const pref = services.authService.setTunnelPreference(req.body || {});
      res.json({ success: true, ...pref });
    });

    // --- SECURE MCP TUNNEL V2 ENDPOINTS ---
    const tunnelProvider = new SelfHostedProvider({
      port,
      bootstrapSecret: services.authService.getApiKey(),
      defaultWorkspaceId: 'ws_default',
    });

    app.post('/tunnel/message', async (req, res) => {
      try {
        const frame = parseTunnelFrame(req.body);
        const response = await tunnelProvider.send(frame);
        res.json(response);
      } catch (err: any) {
        const errFrame = createErrorFrame(err.code || 'BAD_REQUEST', err.category || 'validation', err.message);
        res.status(400).json(errFrame);
      }
    });

    const requireTunnelAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (isLocalRequest(req)) {
        return next();
      }

      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (services.authService.validateApiKey(token) || (tunnelProvider as any).bootstrapSecret === token) {
          return next();
        }
      }

      logger.logAction({
        action: 'blocked_public_tunnel_admin_access',
        params: { path: req.path, host: req.get('host'), ip: req.ip },
        status: 'error',
        durationMs: 0,
        error: `[403 FORBIDDEN] Attempted access to tunnel admin endpoint "${req.path}" via public tunnel (${req.get('host')}). Access restricted to localhost or valid Bearer authentication.`,
      });

      return res.status(403).json(
        createErrorFrame(
          'ADMIN_ACCESS_DENIED',
          'auth',
          'This tunnel endpoint is restricted to localhost or requires valid admin Bearer authentication.'
        )
      );
    };

    app.get('/tunnel/status', requireTunnelAdmin, (_req, res) => {
      res.json(tunnelProvider.getStatus());
    });

    app.get('/tunnel/audit', requireTunnelAdmin, (_req, res) => {
      res.json({ events: tunnelProvider.auditLogger.listRecent(50) });
    });

    // Helper to get base URL for OAuth metadata
    function getOAuthBaseUrl(req: express.Request): string {
      const forwardedProto = req.headers['x-forwarded-proto'] || ((req.socket as any)?.encrypted ? 'https' : 'http');
      const host = req.get('host') || `127.0.0.1:${port}`;
      return `${forwardedProto}://${host}`;
    }

    // --- STANDARD OAUTH / DCR METADATA DISCOVERY (FOR OPENAI TUNNEL-CLIENT & PLATFORM) ---
    app.get(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'], (req, res) => {
      const baseUrl = getOAuthBaseUrl(req);
      res.json({
        resource: baseUrl,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ['header'],
        scopes_supported: ['mcp:all', 'file.read', 'file.write', 'terminal.execute'],
      });
    });

    app.get(['/.well-known/oauth-authorization-server/mcp', '/.well-known/oauth-authorization-server'], (req, res) => {
      const baseUrl = getOAuthBaseUrl(req);
      res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        authorization_response_iss_parameter_supported: false,
        client_id_metadata_document_supported: false,
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
        response_types_supported: ['code', 'token'],
        grant_types_supported: ['authorization_code', 'client_credentials'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['mcp:all', 'file.read', 'file.write', 'terminal.execute'],
      });
    });

    app.post('/oauth/register', (req, res) => {
      const { client_name, redirect_uris } = req.body || {};
      res.status(201).json({
        client_id: 'chat-dev-mcp-client',
        client_secret: services.authService.getApiKey(),
        client_name: client_name || 'OpenAI Platform Client',
        redirect_uris: redirect_uris || [],
        grant_types: ['authorization_code', 'client_credentials'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    });

    app.get('/oauth/authorize', (req, res) => {
      const redirectUri = req.query.redirect_uri as string;
      const state = req.query.state as string;
      const code = `mcp_code_${Date.now()}`;

      if (redirectUri) {
        const joinChar = redirectUri.includes('?') ? '&' : '?';
        const target = `${redirectUri}${joinChar}code=${code}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
        return res.redirect(target);
      }

      res.json({
        code,
        state: state || null,
        message: 'OAuth authorization successful. Return code to token endpoint.',
      });
    });

    app.post('/oauth/authorize', (req, res) => {
      const { redirect_uri, state } = req.body || {};
      const code = `mcp_code_${Date.now()}`;

      if (redirect_uri) {
        const joinChar = redirect_uri.includes('?') ? '&' : '?';
        const target = `${redirect_uri}${joinChar}code=${code}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
        return res.redirect(target);
      }

      res.json({
        code,
        state: state || null,
      });
    });

    app.post('/oauth/token', (req, res) => {
      res.json({
        access_token: services.authService.getApiKey(),
        token_type: 'Bearer',
        expires_in: 315360000,
        scope: 'mcp:all',
      });
    });

    app.get('/api/ui/projects', (req, res) => {
      res.json({
        ...services.projectService.listProjects('global', false),
        apiKey: services.authService.getApiKey(),
      });
    });

    app.post('/api/ui/reset_key', (req, res) => {
      const newKey = services.authService.resetApiKey();
      res.json({ success: true, apiKey: newKey });
    });

    app.post('/api/ui/set_key', (req, res) => {
      try {
        const { apiKey } = req.body || {};
        const key = services.authService.setApiKey(apiKey);
        res.json({ success: true, apiKey: key });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/projects', async (req, res) => {
      try {
        const { name, path, description, permissions } = req.body;
        const project = await services.projectService.addProject({
          name,
          path,
          description,
          permissions,
        });
        res.json({ success: true, project });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.put('/api/ui/projects/:id', async (req, res) => {
      try {
        const { name, path, description, permissions } = req.body || {};
        const project = await services.projectService.updateProject(req.params.id, {
          name,
          path,
          description,
          permissions,
        });
        res.json({ success: true, project });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.delete('/api/ui/projects/:id', async (req, res) => {
      try {
        const result = await services.projectService.removeProject(req.params.id, false);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // HTML / JSON Activity Log Viewer (LOCAL ONLY)
    app.get('/logs', requireLocalAccess, (req, res) => {
      const logs = logger.queryActivityLogs({
        cursor: typeof req.query.cursor === 'string' ? Number(req.query.cursor) : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        action: typeof req.query.action === 'string' ? req.query.action : undefined,
        project: typeof req.query.project === 'string' ? req.query.project : undefined,
        status: req.query.status === 'success' || req.query.status === 'error' ? req.query.status : undefined,
        source: req.query.source === 'mcp' || req.query.source === 'rest' ? req.query.source : undefined,
      });
      if (req.query.json === 'true') {
        return res.json(logs);
      }
      res.send(renderDashboardHtml(port));
    });
    app.get('/app', requireLocalAccess, (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderAppPanelHtml(port, os.hostname()));
    });

    app.get('/api/ui/agent_status', (req, res) => {
      const statusObj = logger.getAgentStatus();
      const isRecent = statusObj.currentStatus.isRecent;
      const category = isRecent ? (statusObj.currentStatus.category || 'idle') : 'idle';
      res.json({
        ...statusObj,
        activeAction: category,
      });
    });

    app.post('/api/ui/diagnostics', requireLocalAccess, async (req, res) => {
      try {
        const { task, project } = req.body || {};
        const diagService = services.diagnosticService || new DiagnosticService(services.processService, process.cwd(), services.projectService);
        const result = await diagService.runDiagnostics(task || 'all', { project });
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- OPENAI OFFICIAL TUNNEL-CLIENT UI APIS ---
    app.get('/api/ui/tunnel/openai/status', requireLocalAccess, (_req, res) => {
      const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
      res.json(openAiTunnelService.getStatus());
    });

    app.get('/api/ui/tunnel/openai/profiles', requireLocalAccess, (_req, res) => {
      const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
      res.json(openAiTunnelService.getProfiles());
    });

    app.post('/api/ui/tunnel/openai/profiles', requireLocalAccess, async (req, res) => {
      try {
        const { name, tunnelId, runtimeKey, description } = req.body || {};
        if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Profile name is required' });
        if (typeof tunnelId !== 'string' || !tunnelId.trim()) return res.status(400).json({ error: 'Tunnel ID is required' });
        if (typeof runtimeKey !== 'string' || !runtimeKey.trim()) return res.status(400).json({ error: 'Runtime key is required' });
        if (description !== undefined && typeof description !== 'string') return res.status(400).json({ error: 'Description must be a string' });
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        const profile = await openAiTunnelService.addProfile({ name, tunnelId, runtimeKey, description });
        res.json({ success: true, profile, ...openAiTunnelService.getProfiles() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.put('/api/ui/tunnel/openai/profiles/:id', requireLocalAccess, async (req, res) => {
      try {
        const body = req.body || {};
        for (const field of ['name', 'tunnelId', 'runtimeKey', 'description'] as const) {
          if (body[field] !== undefined && typeof body[field] !== 'string') {
            return res.status(400).json({ error: `${field} must be a string` });
          }
        }
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const profile = await openAiTunnelService.updateProfile(profileId, {
          name: body.name,
          tunnelId: body.tunnelId,
          runtimeKey: body.runtimeKey,
          description: body.description,
        });
        res.json({ success: true, profile, ...openAiTunnelService.getProfiles() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.delete('/api/ui/tunnel/openai/profiles/:id', requireLocalAccess, async (req, res) => {
      try {
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        await openAiTunnelService.deleteProfile(profileId);
        res.json({ success: true, ...openAiTunnelService.getProfiles() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/tunnel/openai/profiles/active', requireLocalAccess, async (req, res) => {
      try {
        const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId.trim() : '';
        if (!profileId) return res.status(400).json({ error: 'profileId is required' });
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        await openAiTunnelService.setActiveProfile(profileId);
        res.json({ success: true, ...openAiTunnelService.getProfiles() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/tunnel/openai/config', requireLocalAccess, async (req, res) => {
      try {
        const { tunnelId, runtimeKey } = req.body || {};
        if (tunnelId !== undefined && typeof tunnelId !== 'string') return res.status(400).json({ error: 'tunnelId must be a string' });
        if (runtimeKey !== undefined && typeof runtimeKey !== 'string') return res.status(400).json({ error: 'runtimeKey must be a string' });
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        await openAiTunnelService.saveConfig(tunnelId || '', runtimeKey || '');
        res.json({ success: true, ...openAiTunnelService.getStatus() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/ui/tunnel/openai/start', requireLocalAccess, async (req, res) => {
      try {
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        const status = await openAiTunnelService.startTunnel({ mode: 'http', port, ...getOpenAiTunnelStartRequest(req.body) });
        res.json({ success: true, ...status });
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(/profile|Missing OpenAI tunnel/i.test(message) ? 400 : 500).json({ error: message });
      }
    });

    app.post('/api/ui/tunnel/openai/stop', requireLocalAccess, async (_req, res) => {
      try {
        const openAiTunnelService = services.openAiTunnelService || new OpenAiTunnelService(process.cwd());
        await openAiTunnelService.stopTunnel();
        res.json({ success: true, ...openAiTunnelService.getStatus() });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- SECURITY MIDDLEWARE FOR CHATGPT / AI API CALLS ---
    app.use('/api', (req, res, next) => {
      req.setTimeout(300000);
      res.setTimeout(300000);
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Keep-Alive', 'timeout=300');

      if (req.path.startsWith('/ui')) {
        return next();
      }
      const authHeader = (req.headers['authorization'] || req.headers['x-api-key']) as string | undefined;
      if (!services.authService.validateApiKey(authHeader)) {
        logger.logAction({
          action: req.path.replace('/api/', ''),
          params: req.body || {},
          status: 'error',
          durationMs: 0,
          error: `[401 UNAUTHORIZED] Missing or invalid API Key token. Received Header: "${authHeader ?? 'NONE'}". Expected Key: "${services.authService.getApiKey()}". Request rejected.`,
        });
        return res.status(401).json({
          error: 'Unauthorized: Missing or invalid API Key token. Please set Authorization: Bearer <API_KEY> in ChatGPT Action settings.',
        });
      }
      next();
    });

    // OpenAPI Specification for ChatGPT Custom GPT Actions & API Clients
    // Note: ChatGPT Actions enforce a strict maximum limit of 30 operations.
    // Default /openapi.json uses the active profile selected in UI Settings (defaults to "core" 22 ops <= 30).
    app.get(['/openapi.json', '/openapi-core.json', '/openapi/core.json'], (req, res) => {
      const hostUrl = `https://${req.get('host')}`;
      const pref = services.authService.getProfilePreference();
      const profile = (req.query.profile as any) || (req.path === '/openapi.json' ? pref.profile : 'core');
      res.json(getOpenApiSpec(hostUrl, profile, pref.customTools));
    });

    app.get(['/openapi-agent.json', '/openapi/agent.json'], (req, res) => {
      const hostUrl = `https://${req.get('host')}`;
      res.json(getOpenApiSpec(hostUrl, 'agent'));
    });

    app.get(['/openapi-extension.json', '/openapi/extension.json'], (req, res) => {
      const hostUrl = `https://${req.get('host')}`;
      res.json(getOpenApiSpec(hostUrl, 'extension'));
    });

    app.get(['/openapi-full.json', '/openapi/full.json'], (req, res) => {
      const hostUrl = `https://${req.get('host')}`;
      res.json(getOpenApiSpec(hostUrl, 'full'));
    });

    app.get(['/openapi-custom.json', '/openapi/custom.json'], (req, res) => {
      const hostUrl = `https://${req.get('host')}`;
      const pref = services.authService.getProfilePreference();
      res.json(getOpenApiSpec(hostUrl, 'custom', pref.customTools));
    });

    // Profile preferences & Tool Catalog endpoints for UI
    app.get('/api/ui/profile/preference', (req, res) => {
      const pref = services.authService.getProfilePreference();
      res.json({
        ...pref,
        catalog: getToolCatalog(),
      });
    });

    app.post('/api/ui/profile/preference', (req, res) => {
      const pref = services.authService.setProfilePreference(req.body || {});
      res.json({
        success: true,
        ...pref,
      });
    });

    // Multi-Profile discovery endpoint for UI & tooling
    app.get('/api/ui/openapi/profiles', (req, res) => {
      const hostUrl = `https://${req.get('host')}`;
      const pref = services.authService.getProfilePreference();
      const customCount = pref.customTools ? pref.customTools.length : 25;
      const opCounts = getProfileOpCounts();
      const profiles = [
        {
          id: 'core',
          name: 'Core Dev (Recommended)',
          opsCount: opCounts.core,
          isChatGptCompatible: opCounts.core <= 30,
          description: 'Essential local coding tools: Workspace Health, Files CRUD, Search, Git, Shell, Snapshot, Safe Patch, and Skills (.skills/ discovery & runbooks).',
          url: `${hostUrl}/openapi.json`,
        },
        {
          id: 'agent',
          name: 'Agent Dev',
          opsCount: opCounts.agent,
          isChatGptCompatible: opCounts.agent <= 30,
          description: 'Core Dev tools + Codex Autonomous Agent execution capability.',
          url: `${hostUrl}/openapi-agent.json`,
        },
        {
          id: 'extension',
          name: 'Skills & Extension',
          opsCount: opCounts.extension,
          isChatGptCompatible: opCounts.extension <= 30,
          description: 'Core Dev tools + Agent Skills discovery and reading.',
          url: `${hostUrl}/openapi-extension.json`,
        },
        {
          id: 'full',
          name: 'Full MCP Spec',
          opsCount: opCounts.full,
          isChatGptCompatible: opCounts.full <= 30,
          description: `Full unconstrained specification containing all ${opCounts.full} operations.`,
          url: `${hostUrl}/openapi-full.json`,
        },
        {
          id: 'custom',
          name: 'Custom Tailored Profile',
          opsCount: customCount,
          isChatGptCompatible: customCount <= 30,
          description: 'User-customized selection of tools tailored from Web Dashboard.',
          url: `${hostUrl}/openapi-custom.json`,
        },
      ];
      res.json({ profiles, activeProfile: pref.profile });
    });

    function getSessionId(req: express.Request): string {
      const fromHeader = (req.headers['x-session-id'] || req.headers['mcp-session-id']) as string | undefined;
      if (fromHeader && fromHeader.trim()) return fromHeader.trim();
      const fromQuery = req.query.sessionId as string | undefined;
      if (fromQuery && fromQuery.trim()) return fromQuery.trim();
      const fromBody = req.body?.session_id || req.body?.sessionId;
      if (fromBody && typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
      return 'global';
    }

    const testRunnerService = new TestRunnerService(services.processService, process.cwd(), services.projectService);
    const workspaceHealthService = new WorkspaceHealthService(
      services.projectService,
      services.gitService,
      services.diagnosticService || new DiagnosticService(services.processService, process.cwd(), services.projectService),
      services.processService,
      services.memoryService,
      process.cwd()
    );

    // REST API Action Handlers for ChatGPT with full logging

    app.all('/api/workspace_health', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { cwd, project } = req.body || {};
        const health = await workspaceHealthService.getHealth({
          customCwd: cwd,
          project,
        });
        logger.logAction({
          action: 'workspace_health',
          params: { cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: health.summary,
        });
        res.json(health);
      } catch (err: any) {
        logger.logAction({
          action: 'workspace_health',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/run_tests', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { customCommand, testFilter, cwd, project, timeoutMs } = req.body || {};
        const perm = services.projectService.checkPermission('command', cwd, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason });
        }
        const result = await testRunnerService.runTests({
          customCommand,
          testFilter,
          customCwd: cwd,
          project,
          timeoutMs,
        });
        logger.logAction({
          action: 'run_tests',
          params: { customCommand, testFilter, cwd, project },
          status: result.status === 'passed' ? 'success' : 'error',
          durationMs: Date.now() - start,
          resultSummary: result.summary,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'run_tests',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/process_manager', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { action, command, processId, cwd, lines, project } = req.body || {};
        const perm = services.projectService.checkPermission('command', cwd, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason });
        }
        const result = await services.processService.manageProcess({
          action,
          command,
          processId,
          cwd,
          lines,
          projectName: project,
        });
        logger.logAction({
          action: 'process_manager',
          params: { action, command, processId, cwd },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Action: ${action}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'process_manager',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/git_branch', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { cwd, project } = req.body || {};
        const gitWorkflow = services.gitWorkflowService || new GitWorkflowService(services.processService, process.cwd(), services.projectService);
        const result = await gitWorkflow.getBranchDetails(cwd, project);
        logger.logAction({
          action: 'git_branch',
          params: { cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Current: ${result.currentBranch}, Total: ${result.branches.length} branches`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_branch',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/git_push', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { branch, remote, setUpstream, force, dryRun, cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('command', cwd, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason });
        }
        const gitWorkflow = services.gitWorkflowService || new GitWorkflowService(services.processService, process.cwd(), services.projectService);
        const result = await gitWorkflow.pushBranch({
          branch,
          remote,
          setUpstream,
          force,
          dryRun,
          customCwd: cwd,
          project,
        });
        logger.logAction({
          action: 'git_push',
          params: { branch, remote, dryRun, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Pushed ${result.branch} to ${result.remote}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_push',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/list_projects', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const result = services.projectService.listProjects(sessionId);
        logger.logAction({
          action: 'list_projects',
          params: {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Total: ${result.projects.length} projects`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'list_projects',
          params: {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });


    app.post('/api/add_project', async (req, res) => {
      const start = Date.now();
      try {
        const { name, path: projectPath, description } = req.body;
        const result = await services.projectService.addProject({ name, path: projectPath, description });
        logger.logAction({
          action: 'add_project',
          params: req.body,
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Registered existing project ${result.name}`,
        });
        res.json({ message: `Project '${result.name}' registered successfully`, project: services.projectService.sanitizeProjectForClient(result) });
      } catch (err: any) {
        logger.logAction({
          action: 'add_project',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/create_project', async (req, res) => {
      const start = Date.now();
      try {
        const { name, path: projectPath, description } = req.body;
        const result = await services.projectService.createProject({ name, path: projectPath, description });
        logger.logAction({
          action: 'create_project',
          params: req.body,
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Created project ${result.name}`,
        });
        res.json({ message: `Project '${result.name}' created successfully`, project: services.projectService.sanitizeProjectForClient(result) });
      } catch (err: any) {
        logger.logAction({
          action: 'create_project',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(400).json({ error: err.message, errorCode: err.code || 'TOOL_ERROR', category: err.category || 'validation' });
      }
    });

    app.post('/api/prepare_project_removal', async (req, res) => {
      const start = Date.now();
      try {
        const { name } = req.body;
        const result = await services.projectService.prepareProjectRemoval(name);
        logger.logAction({
          action: 'prepare_project_removal',
          params: { name },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Prepared destructive removal for ${result.projectName}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'prepare_project_removal',
          params: { name: req.body?.name },
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/remove_project', async (req, res) => {
      const start = Date.now();
      try {
        const { name, delete_files, confirmation_token } = req.body;
        const result = await services.projectService.removeProject(name, delete_files, confirmation_token);
        logger.logAction({
          action: 'remove_project',
          params: req.body,
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: result.message,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'remove_project',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/read_file', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { path, start_line, end_line, cwd, project } = req.body;
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'read_file',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.fileService.readFile(path, {
          startLine: start_line,
          endLine: end_line,
          customCwd: cwd,
          project,
        });
        const projectName = perm.project ? perm.project.name : 'Unknown';
        const projectPermissions = perm.project ? perm.project.permissions : undefined;
        logger.logAction({
          action: 'read_file',
          params: req.body,
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Read ${result.content.split('\n').length} lines from ${path} (Project: ${projectName})`,
        });
        res.json({
          ...result,
          _projectContext: {
            project: projectName,
            rootPath: '.',
            permissions: projectPermissions,
          },
        });
      } catch (err: any) {
        logger.logAction({
          action: 'read_file',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/write_file', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { path, content, cwd, project } = req.body;
        const perm = services.projectService.checkPermission('write', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'write_file',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.fileService.writeFile(path, content, { customCwd: cwd, project });
        const projectName = perm.project ? perm.project.name : 'Unknown';
        const projectPermissions = perm.project ? perm.project.permissions : undefined;
        logger.logAction({
          action: 'write_file',
          params: { path, contentLength: content?.length, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Wrote ${result.bytesWritten} bytes to ${result.path} (Project: ${projectName})`,
        });
        res.json({
          ...result,
          _projectContext: {
            project: projectName,
            rootPath: '.',
            permissions: projectPermissions,
          },
        });
      } catch (err: any) {
        logger.logAction({
          action: 'write_file',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/edit_file', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const filePath = req.body.path;
        const target = req.body.target_content ?? req.body.old_text ?? req.body.search_string ?? req.body.oldText;
        const replacement = req.body.replacement_content ?? req.body.new_text ?? req.body.replace_string ?? req.body.newText ?? '';
        const allowMultiple = req.body.allow_multiple ?? req.body.allowMultiple ?? false;
        const expectedBeforeHash = req.body.expected_before_hash ?? req.body.expected_sha256 ?? req.body.expectedBeforeHash;
        const cwd = req.body.cwd;
        const project = req.body.project;

        const perm = services.projectService.checkPermission('write', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'edit_file',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.fileService.editFile(filePath, target, replacement, {
          allowMultiple,
          expectedBeforeHash,
          customCwd: cwd,
          project,
        });
        const projectName = perm.project ? perm.project.name : 'Unknown';
        const projectPermissions = perm.project ? perm.project.permissions : undefined;
        logger.logAction({
          action: 'edit_file',
          params: { path: filePath, target: target?.substring(0, 50), cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Replaced ${result.occurrencesReplaced} occurrence(s) in ${filePath} (Project: ${projectName})`,
        });
        res.json({
          ...result,
          _projectContext: {
            project: projectName,
            rootPath: '.',
            permissions: projectPermissions,
          },
        });
      } catch (err: any) {
        logger.logAction({
          action: 'edit_file',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/list_directory', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { path = '.', recursive, max_depth, cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'list_directory',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.fileService.listDirectory(path, {
          recursive,
          maxDepth: max_depth,
          customCwd: cwd,
          project,
        });
        const projectName = perm.project ? perm.project.name : 'Unknown';
        const projectPermissions = perm.project ? perm.project.permissions : undefined;
        logger.logAction({
          action: 'list_directory',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Listed ${result.items.length} items in ${path} (Project: ${project})`,
        });
        res.json({
          ...result,
          _projectContext: {
            project: projectName,
            rootPath: '.',
            permissions: projectPermissions,
          },
        });
      } catch (err: any) {
        logger.logAction({
          action: 'list_directory',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/run_command', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { command, cwd, timeout_ms, is_daemon, project } = req.body;
        const perm = services.projectService.checkPermission('command', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'run_command',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.processService.runCommand({
          command,
          cwd,
          timeoutMs: timeout_ms,
          isDaemon: is_daemon,
          projectName: project,
        });
        const projectName = perm.project ? perm.project.name : 'Unknown';
        const projectPermissions = perm.project ? perm.project.permissions : undefined;
        logger.logAction({
          action: 'run_command',
          params: { command, cwd, is_daemon, project },
          status: result.status === 'failed' || result.status === 'timed_out' ? 'error' : 'success',
          durationMs: Date.now() - start,
          resultSummary: `Exit code: ${result.exitCode ?? 'N/A'}, Stdout: ${result.stdout.slice(0, 100).trim() || '(empty)'}`,
          error: result.status === 'failed' || result.status === 'timed_out' ? result.stderr : undefined,
        });
        res.json({
          ...result,
          _projectContext: {
            project: projectName,
            rootPath: '.',
            permissions: projectPermissions,
          },
        });
      } catch (err: any) {
        logger.logAction({
          action: 'run_command',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({
          error: {
            code: err.code || 'COMMAND_EXECUTION_FAILED',
            message: err.message || String(err),
            retryable: Boolean(err.retryable),
          },
        });
      }
    });

    app.post('/api/search_files', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { query, is_regex, case_sensitive, file_pattern, max_results, cwd, project } = req.body;
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'search_files',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.searchService.searchFiles(query, {
          isRegex: is_regex,
          caseSensitive: case_sensitive,
          filePattern: file_pattern,
          maxResults: max_results,
          customCwd: cwd,
          project,
        });
        logger.logAction({
          action: 'search_files',
          params: { query, file_pattern, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.totalMatches} matches`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'search_files',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/find_files', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { pattern = '**/*', cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'find_files',
            params: req.body || {},
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.searchService.findFiles(pattern, { customCwd: cwd, project });
        logger.logAction({
          action: 'find_files',
          params: { pattern, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.length} files matching ${pattern}`,
        });
        res.json({ count: result.length, files: result });
      } catch (err: any) {
        logger.logAction({
          action: 'find_files',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/git_status', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'git_status',
            params: req.body || {},
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.gitService.getStatus({ customCwd: cwd, project });
        logger.logAction({
          action: 'git_status',
          params: { cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Branch: ${result.branch || 'none'}, Modified: ${result.summary?.modified.length || 0}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_status',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/git_diff', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { staged, cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'git_diff',
            params: req.body || {},
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason });
        }

        const result = await services.gitService.getDiff(cwd, staged, project);
        logger.logAction({
          action: 'git_diff',
          params: { staged, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Diff returned ${result.diff.length} chars`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_diff',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/read_project_instructions', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { project } = req.body || {};
        const targetPath = services.projectService.getRequiredProject(project).path;
        const result = services.memoryService.findProjectInstructionsSync(targetPath);
        logger.logAction({
          action: 'read_project_instructions',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: result.exists ? `Read ${result.fileName} (${result.content?.length} chars)` : 'No instruction file found',
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'read_project_instructions',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/read_handoff', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { path: customPath, file_path, project } = (req.method === 'POST' ? req.body : req.query) || {};
        const perm = services.projectService.checkPermission('handoff', undefined, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason || 'Permission denied' });
        }
        const targetPath = services.projectService.getRequiredProject(project).path;
        const result = await services.memoryService.readHandoff(targetPath, customPath || file_path);
        logger.logAction({
          action: 'read_handoff',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Read handoff for ${project}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'read_handoff',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/write_handoff', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { path: customPath, file_path, content, markdown, summary, next_steps, persist = 'server', project } = req.body || {};
        const perm = services.projectService.checkPermission('handoff', undefined, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason || 'Permission denied' });
        }
        const targetPath = services.projectService.getRequiredProject(project).path;
        const result = await services.memoryService.writeHandoff(targetPath, {
          path: customPath || file_path,
          content: content || markdown,
          summary: summary || '',
          nextSteps: next_steps || [],
          persist,
        });
        logger.logAction({
          action: 'write_handoff',
          params: { filePath: result.filePath, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Saved handoff to ${result.filePath}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'write_handoff',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/get_system_prompt', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { project } = req.body || {};
        const verified = services.projectService.ensureWithinProject('.', undefined, project, sessionId);
        const prompt = services.projectService.generateSystemPrompt(verified.project);
        logger.logAction({
          action: 'get_system_prompt',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Generated system prompt for ${verified.project.name} (${prompt.length} chars)`,
        });
        res.json({
          project: verified.project.name,
          systemPrompt: prompt,
        });
      } catch (err: any) {
        logger.logAction({
          action: 'get_system_prompt',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/list_skills', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { project } = req.body || {};
        const verified = services.projectService.ensureWithinProject('.', undefined, project, sessionId);
        const canUseSkills = verified.project.permissions.canUseSkills !== false;
        const skills = services.projectService.getAvailableSkillsSync(verified.project.path, canUseSkills);
        logger.logAction({
          action: 'list_skills',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${skills.length} skills in ${verified.project.name}`,
        });
        res.json({
          project: verified.project.name,
          skillsEnabled: canUseSkills,
          totalSkills: skills.length,
          skills,
        });
      } catch (err: any) {
        logger.logAction({
          action: 'list_skills',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/read_skill', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { skill_name, project } = req.body || {};
        const verified = services.projectService.ensureWithinProject('.', undefined, project, sessionId);
        const canUseSkills = verified.project.permissions.canUseSkills !== false;
        const detail = await services.projectService.readSkill(verified.project.path, skill_name, canUseSkills);
        logger.logAction({
          action: 'read_skill',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Read skill ${detail.name} (${detail.content?.length} chars)`,
        });
        res.json(detail);
      } catch (err: any) {
        logger.logAction({
          action: 'read_skill',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    // --- PHASE 1 ADVANCED DEVELOPER TOOL HANDLERS ---

    const patchService = services.patchService || new PatchService(process.cwd(), services.projectService);
    const diagnosticService = services.diagnosticService || new DiagnosticService(services.processService, process.cwd(), services.projectService);

    app.post('/api/apply_patch', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { chunks, diff, cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('write', cwd, project, sessionId);
        if (!perm.allowed) {
          logger.logAction({
            action: 'apply_patch',
            params: req.body,
            status: 'error',
            durationMs: Date.now() - start,
            error: perm.reason,
          });
          return res.status(403).json({ error: perm.reason || 'Permission denied' });
        }

        let result;
        if (chunks && chunks.length > 0) {
          result = await patchService.applyStructuredPatch(chunks, { customCwd: cwd, project });
        } else if (diff) {
          result = await patchService.applyUnifiedDiff(diff, { customCwd: cwd, project });
        } else {
          return res.status(400).json({ error: 'Must provide either chunks or diff in request body.' });
        }

        const projectName = perm.project ? perm.project.name : 'Unknown';
        logger.logAction({
          action: 'apply_patch',
          params: { chunksCount: chunks?.length, diffLength: diff?.length, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Applied patch across ${result.filesModified.length} file(s) (Project: ${projectName})`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'apply_patch',
          params: req.body,
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        const patchError = serializePatchError(err);
        res.status(patchError ? 400 : 500).json(patchError || { error: err.message });
      }
    });

    app.post('/api/git_log', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { max_count, cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('read', cwd, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason || 'Permission denied' });
        }

        const result = await services.gitService.getLog({ maxCount: max_count, customCwd: cwd, project });
        logger.logAction({
          action: 'git_log',
          params: req.body || {},
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.commits.length} commits`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_log',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/git_commit', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { message, files, cwd, project } = req.body || {};
        const perm = services.projectService.checkPermission('write', cwd, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason || 'Permission denied' });
        }

        const result = await services.gitService.commit({ message, files, customCwd: cwd, project });
        logger.logAction({
          action: 'git_commit',
          params: { message, files, cwd, project },
          status: result.success ? 'success' : 'error',
          durationMs: Date.now() - start,
          resultSummary: result.success ? `Committed: ${result.commitHash} - ${message}` : result.error,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_commit',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/project_diagnostics', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { task, options } = getProjectDiagnosticsRequest(req.body);
        const { customCwd: cwd, project } = options;
        const perm = services.projectService.checkPermission('command', cwd, project, sessionId);
        if (!perm.allowed) {
          return res.status(403).json({ error: perm.reason || 'Permission denied' });
        }

        const result = await diagnosticService.runDiagnostics(task, options);
        logger.logAction({
          action: 'project_diagnostics',
          params: { task, cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Diagnostic ${task || 'all'} completed`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'project_diagnostics',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    // --- SNAPSHOT & SYMBOL CODE INTELLIGENCE REST HANDLERS ---

    const snapshotService = services.snapshotService || new SnapshotService(services.projectService, services.gitService, services.memoryService);
    const symbolService = services.symbolService || new SymbolService(process.cwd(), services.projectService);

    app.all('/api/get_project_snapshot', async (req, res) => {
      const start = Date.now();
      const sessionId = getSessionId(req);
      try {
        const { known_instruction_hash, project, cwd } = (req.method === 'POST' ? req.body : req.query) || {};
        const snapshot = await snapshotService.getSnapshot({
          knownInstructionHash: known_instruction_hash,
          project,
          customCwd: cwd,
          sessionId,
        });
        logger.logAction({
          action: 'get_project_snapshot',
          params: { project, unchanged: snapshot.instructions.unchanged },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Snapshot for ${snapshot.project.name} (branch: ${snapshot.git.branch}, head: ${snapshot.git.headCommit.slice(0, 7)})`,
        });
        res.json(snapshot);
      } catch (err: any) {
        logger.logAction({
          action: 'get_project_snapshot',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/list_symbols', async (req, res) => {
      const start = Date.now();
      try {
        const { file_path, project, cwd } = req.body || {};
        if (!file_path) {
          return res.status(400).json({ error: 'file_path is required' });
        }
        const result = await symbolService.listSymbols(file_path, { customCwd: cwd, project });
        logger.logAction({
          action: 'list_symbols',
          params: { file_path, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.totalSymbols} symbols in ${result.filePath}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'list_symbols',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/read_symbol', async (req, res) => {
      const start = Date.now();
      try {
        const { file_path, symbol_name, project, cwd } = req.body || {};
        if (!file_path || !symbol_name) {
          return res.status(400).json({ error: 'file_path and symbol_name are required' });
        }
        const result = await symbolService.readSymbol(file_path, symbol_name, { customCwd: cwd, project });
        logger.logAction({
          action: 'read_symbol',
          params: { file_path, symbol_name, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Read ${result.symbol.kind} "${result.symbol.name}" (${result.symbol.totalLines} lines)`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'read_symbol',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    const gitWorkflowService = services.gitWorkflowService || new GitWorkflowService(services.processService, process.cwd(), services.projectService);
    const diagnosticParserService = services.diagnosticParserService || new DiagnosticParserService(services.processService, process.cwd(), services.projectService);

    app.all('/api/git_sync_status', async (req, res) => {
      const start = Date.now();
      try {
        const { cwd, project } = (req.method === 'POST' ? req.body : req.query) || {};
        const result = await gitWorkflowService.getSyncStatus(cwd, project);
        logger.logAction({
          action: 'git_sync_status',
          params: { cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Branch: ${result.branch}, Divergence: ${result.divergence}, Fingerprint: ${result.fingerprint}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'git_sync_status',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/list_worktrees', async (req, res) => {
      const start = Date.now();
      try {
        const { cwd, project } = (req.method === 'POST' ? req.body : req.query) || {};
        const result = await gitWorkflowService.listWorktrees(cwd, project);
        logger.logAction({
          action: 'list_worktrees',
          params: { cwd, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.total} git worktrees`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'list_worktrees',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/compare_branches', async (req, res) => {
      const start = Date.now();
      try {
        const { base_branch, target_branch, cwd, project } = req.body || {};
        if (!base_branch) {
          return res.status(400).json({ error: 'base_branch is required' });
        }
        const result = await gitWorkflowService.compareBranches(base_branch, target_branch || 'HEAD', cwd, project);
        logger.logAction({
          action: 'compare_branches',
          params: { base_branch, target_branch, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `${result.baseBranch}..${result.targetBranch}: +${result.aheadCount}/-${result.behindCount} commits, ${result.filesChangedCount} files changed`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'compare_branches',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/build_diagnostics', async (req, res) => {
      const start = Date.now();
      try {
        const { target, custom_command, cwd, project } = req.body || {};
        const result = await diagnosticParserService.runBuildDiagnostics({
          target,
          customCommand: custom_command,
          customCwd: cwd,
          project,
        });
        logger.logAction({
          action: 'build_diagnostics',
          params: { target, project },
          status: result.cleanBuild ? 'success' : 'error',
          durationMs: Date.now() - start,
          resultSummary: `Build ${result.cleanBuild ? 'Clean' : 'Failed'}: ${result.totalErrors} errors, ${result.totalWarnings} warnings, ${result.unparsedRelevantLines.length} unparsed lines`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'build_diagnostics',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });


    app.post('/api/find_references', async (req, res) => {
      const start = Date.now();
      try {
        const { symbol_name, file_pattern, max_results, cwd, project } = req.body || {};
        if (!symbol_name) return res.status(400).json({ error: 'symbol_name is required' });
        const result = await symbolService.findReferences(symbol_name, {
          filePattern: file_pattern,
          maxResults: max_results,
          customCwd: cwd,
          project,
        });
        logger.logAction({
          action: 'find_references',
          params: { symbol_name, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.totalMatches} references in ${result.filesScanned} files`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'find_references',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/search_context', async (req, res) => {
      const start = Date.now();
      try {
        const { query, context_lines, is_regex, case_sensitive, file_pattern, cwd } = req.body || {};
        if (!query) return res.status(400).json({ error: 'query is required' });
        const result = await services.searchService.searchWithContext(query, {
          contextLines: context_lines,
          isRegex: is_regex,
          caseSensitive: case_sensitive,
          filePattern: file_pattern,
          customCwd: cwd,
        });
        logger.logAction({
          action: 'search_context',
          params: { query },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Found ${result.totalMatches} matches in ${result.filesCount} files`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'search_context',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/delete_file', async (req, res) => {
      const start = Date.now();
      try {
        const { path: targetPath, force, cwd, project } = req.body || {};
        if (!targetPath) return res.status(400).json({ error: 'path is required' });
        const result = await services.fileService.deleteFile(targetPath, { force, customCwd: cwd, project });
        logger.logAction({
          action: 'delete_file',
          params: { path: targetPath, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Deleted ${result.path}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'delete_file',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/move_file', async (req, res) => {
      const start = Date.now();
      try {
        const { source_path, dest_path, overwrite, cwd, project } = req.body || {};
        if (!source_path || !dest_path) return res.status(400).json({ error: 'source_path and dest_path are required' });
        const result = await services.fileService.moveFile(source_path, dest_path, { overwrite, customCwd: cwd, project });
        logger.logAction({
          action: 'move_file',
          params: { source_path, dest_path, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Moved ${result.from} -> ${result.to}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'move_file',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/hash_file', async (req, res) => {
      const start = Date.now();
      try {
        const { path: targetPath, cwd, project } = req.body || {};
        if (!targetPath) return res.status(400).json({ error: 'path is required' });
        const result = await services.fileService.hashFile(targetPath, { customCwd: cwd, project });
        logger.logAction({
          action: 'hash_file',
          params: { path: targetPath, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `SHA256: ${result.sha256.slice(0, 16)}... (${result.sizeBytes} bytes)`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'hash_file',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/compare_file_content', async (req, res) => {
      const start = Date.now();
      try {
        const { path_a, path_b, cwd, project } = req.body || {};
        if (!path_a || !path_b) return res.status(400).json({ error: 'path_a and path_b are required' });
        const result = await services.fileService.compareFileContent(path_a, path_b, { customCwd: cwd, project });
        logger.logAction({
          action: 'compare_file_content',
          params: { path_a, path_b, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Identical: ${result.identical} (${result.pathA} vs ${result.pathB})`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'compare_file_content',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/close_feature_branch', async (req, res) => {
      const start = Date.now();
      try {
        const { branch_name, target_branch, verification_command, delete_remote, cwd, project } = req.body || {};
        if (!branch_name) return res.status(400).json({ error: 'branch_name is required' });
        const result = await gitWorkflowService.closeFeatureBranch({
          branchName: branch_name,
          targetBranch: target_branch,
          verificationCommand: verification_command,
          deleteRemote: delete_remote,
          customCwd: cwd,
          project,
        });
        logger.logAction({
          action: 'close_feature_branch',
          params: { branch_name, target_branch, project },
          status: 'success',
          durationMs: Date.now() - start,
          resultSummary: `Closed ${result.branchClosed} into ${result.targetBranch}`,
        });
        res.json(result);
      } catch (err: any) {
        logger.logAction({
          action: 'close_feature_branch',
          params: req.body || {},
          status: 'error',
          durationMs: Date.now() - start,
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/health', (req, res) => {
      res.json({ status: 'ok', server: 'local-dev-tool-mcp', activeSessions: transports.size });
    });

    async function handleSseConnection(req: express.Request, res: express.Response) {
      console.log('New SSE connection established');
      configureSseResponse(res);

      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        console.log(`SSE session ${transport.sessionId} closed`);
        transports.delete(transport.sessionId);
      };

      await server.connect(transport);
    }

    app.get(['/sse', '/api/sse'], handleSseConnection);

    app.get('/', (req, res) => {
      if (shouldServeSse(req)) {
        return handleSseConnection(req, res);
      }
      return requireLocalAccess(req, res, () => {
        res.send(renderDashboardHtml(port));
      });
    });

    app.post('/messages', async (req, res) => {
      const sessionId = req.query.sessionId as string;
      let transport: SSEServerTransport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
      } else if (transports.size > 0) {
        transport = transports.values().next().value;
      }

      if (!transport) {
        const dummyRes: any = {
          writeHead: () => {},
          write: () => {},
          end: () => {},
          on: () => {},
          once: () => {},
          emit: () => {},
          listeners: () => [],
        };
        const fallback = new SSEServerTransport('/messages', dummyRes);
        transports.set(fallback.sessionId, fallback);
        fallback.onclose = () => {
          transports.delete(fallback.sessionId);
        };
        await server.connect(fallback);
        transport = fallback;
      }

      await forwardSsePostMessage(transport, req, res);
    });

    // Direct Stateless JSON-RPC MCP Endpoint (For OpenAI tunnel-client, MCP Probes & HTTP Client integration)
    app.post(['/', '/mcp', '/api/mcp'], async (req, res) => {
      const jsonRpcBody = req.body;
      if (!jsonRpcBody || !jsonRpcBody.method) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid JSON-RPC Request' },
          id: req.body?.id || null,
        });
      }

      try {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);

        const responsePromise = new Promise((resolve) => {
          clientTransport.onmessage = (message) => {
            resolve(message);
          };
        });

        await clientTransport.send(jsonRpcBody);
        if (isJsonRpcNotification(jsonRpcBody)) {
          await clientTransport.close().catch(() => {});
          await serverTransport.close().catch(() => {});
          return res.status(202).end();
        }
        const responseMessage = await Promise.race([
          responsePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('MCP Request Timeout')), 15000)),
        ]).catch((err: any) => ({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message || 'Internal error' },
          id: jsonRpcBody.id || null,
        }));

        await clientTransport.close().catch(() => {});
        await serverTransport.close().catch(() => {});

        res.json(responseMessage);
      } catch (err: any) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message },
          id: jsonRpcBody.id || null,
        });
      }
    });

    const onListening = async () => {
      const displayHost = host || 'localhost';
      console.log(`Local Dev Tool MCP Server running at http://${displayHost}:${port}`);
      console.log(`  - Local Dashboard (Local Only): http://${displayHost}:${port}/logs`);
      console.log(`  - Local OpenAPI Schema: http://${displayHost}:${port}/openapi.json`);
      console.log(`  - Local SSE Endpoint: http://${displayHost}:${port}/sse`);
      console.log(`  - Health Check: http://${displayHost}:${port}/health`);

      const opCounts = getProfileOpCounts();
      const targetTunnel = resolveStartupTunnel(services.authService.getTunnelPreference());

      if (targetTunnel === 'ngrok') {
        const activeToken = ngrokToken || services.ngrokService.getAuthtoken();
        if (activeToken) {
          try {
            const status = await services.ngrokService.start(port, activeToken);
            if (status.url) {
              console.log(`  - Ngrok Public API URL: ${status.url}`);
              console.log(`    ⭐ Core Profile (${opCounts.core} Ops):      ${status.url}/openapi.json`);
              console.log(`    🤖 Agent Profile (${opCounts.agent} Ops):     ${status.url}/openapi-agent.json`);
              console.log(`    🧩 Extension Profile (${opCounts.extension} Ops): ${status.url}/openapi-extension.json`);
              console.log(`    📦 Full Profile (${opCounts.full} Ops):      ${status.url}/openapi-full.json`);
              console.log('  - (Note: Web Dashboard & UI APIs are strictly locked to Localhost for security)');
            }
          } catch (err: any) {
            console.error('Failed to establish ngrok tunnel:', err.message);
          }
        }
      } else if (targetTunnel === 'openai' && services.openAiTunnelService) {
        try {
          const status = services.openAiTunnelService.getStatus();
          if (status.tunnelId && status.runtimeKeyConfigured) {
            const startResult = await services.openAiTunnelService.startTunnel({ mode: 'http', port });
            console.log(`  - OpenAI Tunnel Client Daemon: Active (Tunnel ID: ${startResult.tunnelId || status.tunnelId || 'Unknown'})`);
          } else {
            console.log('  - OpenAI Tunnel Client: Skipped (Missing Tunnel ID or Runtime Key. Please configure credentials in Dashboard.)');
          }
        } catch (err: any) {
          console.error('Failed to start OpenAI Tunnel daemon:', err.message);
        }
      }

      resolve();
    };

    if (host && host !== '0.0.0.0' && host !== 'localhost') {
      app.listen(port, host, onListening);
    } else {
      app.listen(port, onListening);
    }
  });
}
