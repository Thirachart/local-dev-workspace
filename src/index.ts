import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'node:path';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';

// Auto-load .env if present
const envPath = path.resolve(process.cwd(), '.env');
if (fsSync.existsSync(envPath)) {
  try {
    const envContent = fsSync.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        const val = v.join('=').trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

import { FileService } from './services/fileService.js';
import { SearchService } from './services/searchService.js';
import { ProcessService } from './services/processService.js';
import { GitService } from './services/gitService.js';
import { ProjectService } from './services/projectService.js';
import { AuthService } from './services/authService.js';
import { NgrokService } from './services/ngrokService.js';
import { OpenAiTunnelService } from './services/openaiTunnelService.js';
import { MemoryService } from './services/memoryService.js';
import { PatchService } from './services/patchService.js';
import { DiagnosticService } from './services/diagnosticService.js';
import { SnapshotService } from './services/snapshotService.js';
import { SymbolService } from './services/symbolService.js';
import { GitWorkflowService } from './services/gitWorkflowService.js';
import { DiagnosticParserService } from './services/diagnosticParserService.js';
import { TrayService } from './services/trayService.js';
import { registerTools } from './tools/index.js';
import { startStdioTransport } from './transports/stdio.js';
import { startSseTransport } from './transports/sse.js';
import { ServerConfig } from './types/index.js';
import { Logger } from './utils/logger.js';
import { DeliveryScopeResolver } from './context/deliveryScope.js';

function parseArgs(): ServerConfig & { resetKey?: boolean } {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let isSse = false;
  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4100;
  let host = process.env.HOST || '0.0.0.0';
  let ngrokToken = process.env.NGROK_AUTHTOKEN;
  let resetKey = false;
  let toolProfile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--sse') {
      isSse = true;
    } else if (arg === '--port' || arg === '-p') {
      if (i + 1 < args.length) {
        port = parseInt(args[++i], 10);
      }
    } else if (arg === '--host') {
      if (i + 1 < args.length) {
        host = args[++i];
      }
    } else if (arg === '--ngrok') {
      isSse = true;
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        ngrokToken = args[++i];
      }
    } else if (arg === '--reset-key') {
      resetKey = true;
    } else if (arg === '--profile') {
      if (i + 1 < args.length) {
        toolProfile = args[++i];
      }
    } else if (arg === '--cwd' || arg === '-d') {
      if (i + 1 < args.length) {
        cwd = path.resolve(args[++i]);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Chat Dev MCP Server - Local Development Tools for AI Agents (ChatGPT, Claude, Codex)

Usage:
  local-dev-tool-mcp [options]

Options:
  --sse                     Run in HTTP / Server-Sent Events mode (for ChatGPT, Web Clients)
  --ngrok [token]           Run HTTP mode and provide an Ngrok token; saved tunnel settings still choose what auto-starts
  --profile <name>          Tool profile to register (core | agent | extension | full, default: core in SSE, full in stdio)
  --reset-key               Rotate and generate a new high-entropy Bearer API Key
  --port, -p <num>          Port for SSE server (default: 4100)
  --host <host>             Host for SSE server (default: 0.0.0.0)
  --cwd, -d <path>          Base working directory for file and command operations (default: current dir)
  --help, -h                Show this help message
      `);
      process.exit(0);
    }
  }

  const resolvedProfile = process.env.WINSPACE_TOOL_PROFILE || process.env.TOOL_PROFILE || toolProfile || (isSse ? 'core' : 'full');

  return { cwd, isSse, port, host, ngrokToken, resetKey, toolProfile: resolvedProfile };
}

async function main() {
  const config = parseArgs();
  const authService = new AuthService(config.cwd);

  if (config.resetKey) {
    const newKey = authService.resetApiKey();
    console.log(`\n🔑 [KEY ROTATED] New Bearer API Key generated: ${newKey}`);
    console.log(`📌 Please update your ChatGPT / MCP Client Authorization header.\n`);
    process.exit(0);
  }

  const server = new McpServer({
    name: 'Local Dev Tool MCP',
    version: '2.0.0',
  });

  const projectService = new ProjectService(config.cwd);
  const ngrokService = new NgrokService(config.cwd);
  const openAiTunnelService = new OpenAiTunnelService(config.cwd);
  const memoryService = new MemoryService();
  const fileService = new FileService(config.cwd, projectService);
  const searchService = new SearchService(config.cwd, projectService);
  const processService = new ProcessService(config.cwd, projectService);
  const gitService = new GitService(config.cwd, projectService);
  const patchService = new PatchService(config.cwd, projectService);
  const diagnosticService = new DiagnosticService(processService, config.cwd, projectService);
  const snapshotService = new SnapshotService(projectService, gitService, memoryService);
  const symbolService = new SymbolService(config.cwd, projectService);
  const gitWorkflowService = new GitWorkflowService(processService, config.cwd, projectService);
  const diagnosticParserService = new DiagnosticParserService(processService, config.cwd, projectService);
  const logger = new Logger(config.cwd);
  const deliveryScopeResolver = new DeliveryScopeResolver(config.isSse ? 'http' : 'stdio', randomUUID());

  registerTools(server, {
    deliveryScopeResolver,
    fileService,
    searchService,
    processService,
    gitService,
    projectService,
    memoryService,
    patchService,
    diagnosticService,
    snapshotService,
    symbolService,
    gitWorkflowService,
    diagnosticParserService,
    logger,
  }, {
    toolProfile: config.toolProfile,
  });

  if (authService.isFirstRun) {
    console.log(`\n============================================================`);
    console.log(`🎉 [FIRST RUN] Initialized new workspace on this machine!`);
    console.log(`🔑 Generated Secret API Key: ${authService.getApiKey()}`);
    console.log(`📋 Manage projects & view setup guide at: http://localhost:${config.port}/logs`);
    console.log(`============================================================\n`);
  }

  const trayService = new TrayService(config.port);
  await trayService.start();

  logger.onLog((entry, info) => {
    trayService.notifyToolStart(entry.action, info);
  });

  if (config.isSse) {
    await startSseTransport(
      server,
      {
        fileService,
        searchService,
        processService,
        gitService,
        projectService,
        authService,
        ngrokService,
        openAiTunnelService,
        memoryService,
        patchService,
        diagnosticService,
        snapshotService,
        symbolService,
        gitWorkflowService,
        diagnosticParserService,
            logger,
      },
      config.port,
      config.host,
      config.ngrokToken
    );
  } else {
    await startStdioTransport(server);
  }
}

main().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
