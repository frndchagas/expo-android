#!/usr/bin/env node
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { MCP_HTTP_PORT, MCP_TRANSPORT } from './config.js';
import { assertAdbAvailable, resolveAdbSerial } from './adb.js';
import { registerAndroidTools } from './tools/android.js';

const require = createRequire(import.meta.url);
const { version: MCP_VERSION } = require('../package.json') as { version: string };

const server = new McpServer({
  name: 'expo-android',
  version: MCP_VERSION,
});

registerAndroidTools(server);

async function warmUpAdb() {
  try {
    await assertAdbAvailable();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    await resolveAdbSerial({ strict: false });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(MCP_HTTP_PORT, () => {
    console.log(`MCP HTTP server listening on :${MCP_HTTP_PORT}/mcp`);
  });
}

if (MCP_TRANSPORT === 'stdio') {
  await warmUpAdb();
  await startStdio();
} else if (MCP_TRANSPORT === 'http') {
  await warmUpAdb();
  await startHttp();
} else if (MCP_TRANSPORT === 'both') {
  await warmUpAdb();
  await Promise.all([startStdio(), startHttp()]);
} else {
  throw new Error(`Unknown MCP_TRANSPORT: ${MCP_TRANSPORT}`);
}
