import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const home = process.env.HOME ?? '';
const adbPath =
  process.env.ADB_PATH ?? `${home}/Library/Android/sdk/platform-tools/adb`;
const adbSerial = process.env.ADB_SERIAL ?? 'emulator-5556';

const env = {
  ...process.env,
  ADB_PATH: adbPath,
  ADB_SERIAL: adbSerial,
};

const client = new Client({ name: 'expo-android-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js'],
  env,
});

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

await client.connect(transport);

try {
  const inspect = await client.callTool({
    name: 'inspect',
    arguments: { onlyInteractive: false },
  });

  const elements = Array.isArray(inspect.structuredContent?.elements)
    ? inspect.structuredContent.elements
    : [];

  ensure(elements.length > 0, 'No UI elements returned by inspect.');

  const candidate =
    elements.find((element) => element.text.trim().length > 0) ??
    elements.find((element) => element.contentDesc.trim().length > 0) ??
    elements.find((element) => element.resourceId.trim().length > 0) ??
    elements[0];

  ensure(candidate, 'No candidate element found for search.');

  const criteria = candidate.text.trim().length
    ? { text: candidate.text, normalizeWhitespace: true }
    : candidate.contentDesc.trim().length
      ? { contentDesc: candidate.contentDesc, normalizeWhitespace: true }
      : candidate.resourceId.trim().length
        ? { resourceId: candidate.resourceId }
        : { class: candidate.class };

  const find = await client.callTool({
    name: 'findElement',
    arguments: criteria,
  });

  const count = find.structuredContent?.count ?? 0;
  ensure(count > 0, 'Expected findElement to return at least one match.');

  const assertRes = await client.callTool({
    name: 'assertElement',
    arguments: { ...criteria, shouldExist: true },
  });

  const passed = assertRes.structuredContent?.passed === true;
  ensure(passed, 'assertElement failed for the selected criteria.');

  console.log('MCP smoke test passed on', adbSerial);
} finally {
  await client.close();
}
