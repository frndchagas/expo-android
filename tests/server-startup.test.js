import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'server.js');

function connectWithoutAdb() {
  return new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      ADB_PATH: '/nonexistent/adb',
      MCP_TRANSPORT: 'stdio',
    },
  });
}

async function getAvailablePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');

  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  const { port } = address;
  await new Promise((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function waitForHttpServer(child, port) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for HTTP server. stderr: ${stderr}`));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };
    const onData = (chunk) => {
      stderr += chunk;
      if (stderr.includes(`MCP HTTP server listening on :${port}/mcp`)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Server exited before listening (code=${code}, signal=${signal}). stderr: ${stderr}`
        )
      );
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

test('server completes the MCP handshake when adb is missing', async () => {
  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  await client.connect(connectWithoutAdb());

  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'devices'));
  } finally {
    await client.close();
  }
});

test('tools report the adb-not-found error instead of crashing', async () => {
  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  await client.connect(connectWithoutAdb());

  try {
    const result = await client.callTool({ name: 'devices', arguments: {} });
    assert.equal(result.isError, true);
    const text = result.content
      .map((item) => (item.type === 'text' ? item.text : ''))
      .join('\n');
    assert.match(text, /ADB executable not found/);
    assert.match(text, /ADB_PATH/);

    const doctor = await client.callTool({ name: 'doctor', arguments: {} });
    assert.notEqual(doctor.isError, true);
  } finally {
    await client.close();
  }
});

test('both transport keeps stdio and concurrent HTTP clients isolated', async (t) => {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ADB_PATH: '/nonexistent/adb',
      MCP_TRANSPORT: 'both',
      PORT: String(port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => stopChild(child));
  await waitForHttpServer(child, port);

  const listTools = async (name) => {
    const client = new Client({ name, version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`)
    );
    await client.connect(transport);
    try {
      return (await client.listTools()).tools;
    } finally {
      await client.close();
    }
  };

  const [first, second] = await Promise.all([
    listTools('http-smoke-one'),
    listTools('http-smoke-two'),
  ]);
  assert.ok(first.some((tool) => tool.name === 'devices'));
  assert.ok(second.some((tool) => tool.name === 'devices'));
});
