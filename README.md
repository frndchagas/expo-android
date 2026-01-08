# expo-android

[![npm version](https://img.shields.io/npm/v/@fndchagas/expo-android.svg)](https://www.npmjs.com/package/@fndchagas/expo-android)
[![npm downloads](https://img.shields.io/npm/dm/@fndchagas/expo-android.svg)](https://www.npmjs.com/package/@fndchagas/expo-android)
[![license](https://img.shields.io/npm/l/@fndchagas/expo-android.svg)](LICENSE)
[![node version](https://img.shields.io/node/v/@fndchagas/expo-android.svg)](package.json)
[![typescript](https://img.shields.io/badge/TypeScript-5.9.3-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://github.com/frndchagas/expo-android/actions/workflows/ci.yml/badge.svg)](https://github.com/frndchagas/expo-android/actions/workflows/ci.yml)

MCP server for Android emulator automation via ADB.

## Requirements

- Node 18+
- Android SDK platform-tools (adb) on PATH
- Android emulator or device connected

Verify adb:

```bash
adb devices
```

## Install

```bash
npm install -g @fndchagas/expo-android
# or
npx -y @fndchagas/expo-android
```

## Use with Claude Code CLI

```bash
claude mcp add expo-android \
  --env ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb" \
  --env ADB_SERIAL="emulator-5554" \
  -- npx -y @fndchagas/expo-android
```

## Use with OpenAI Codex CLI

```bash
codex mcp add expo-android \
  --env ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb" \
  --env ADB_SERIAL="emulator-5554" \
  -- npx -y @fndchagas/expo-android
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.expo-android]
command = "npx"
args = ["-y", "@fndchagas/expo-android"]
env = { ADB_PATH = "/Users/you/Library/Android/sdk/platform-tools/adb", ADB_SERIAL = "emulator-5554" }
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `ADB_PATH` | `adb` | Path to adb executable |
| `ADB_SERIAL` | optional | Device serial to target |
| `ADB_TIMEOUT_MS` | `15000` | Timeout for adb commands |
| `ADB_MAX_BUFFER_MB` | `10` | Max output buffer size |
| `MCP_TRANSPORT` | `stdio` | Transport: `stdio`, `http`, or `both` |
| `PORT` | `7332` | HTTP port when using http/both |

## Tools

Tools are exposed under your MCP server name. Example: `expo-android.tap`.

- `devices` — list connected devices and emulators.
- `inspect` — screenshot + UI dump parsed into elements with a summary.
- `findElement` — return elements that match search criteria.
- `tapElement` — find an element and tap its center.
- `waitForElement` — wait until an element appears (optionally with state checks).
- `assertElement` — verify element existence and state.
- `tap` — tap at x/y coordinates.
- `swipe` — swipe between coordinates.
- `longPress` — press and hold at coordinates.
- `inputText` — type text in the focused field.
- `keyEvent` — send Android key events (e.g., BACK, HOME).
- `openApp` — launch an app by package name.
- `listPackages` — list installed package names.

## Search criteria

These tools accept flexible search inputs: `findElement`, `tapElement`,
`waitForElement`, `assertElement`.

Common fields:
- `text`, `textContains`
- `contentDesc`, `contentDescContains`
- `resourceId`, `resourceIdContains`
- `class`
- `normalizeWhitespace`, `caseInsensitive`

## MCP usage examples

### Inspect

```ts
const result = await client.callTool({
  name: 'expo-android.inspect',
  arguments: { onlyInteractive: true, includeScreenshot: true },
});
```

### Tap element

```ts
await client.callTool({
  name: 'expo-android.tapElement',
  arguments: { text: 'Private account' },
});
```

### Wait + assert

```ts
await client.callTool({
  name: 'expo-android.waitForElement',
  arguments: { text: 'Save', timeout: 10000, shouldBeClickable: true },
});

await client.callTool({
  name: 'expo-android.assertElement',
  arguments: { text: 'Private account', shouldBeChecked: true },
});
```
