import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
