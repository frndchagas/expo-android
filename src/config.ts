import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type ResolvedAdb = {
  path: string;
  source: string;
  candidates: string[];
};

function canExecute(filePath: string) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveAdbPath(): ResolvedAdb {
  const candidates: string[] = [];
  const envPath = process.env.ADB_PATH;
  if (envPath) {
    return { path: envPath, source: 'env:ADB_PATH', candidates: [envPath] };
  }

  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (androidHome) {
    candidates.push(join(androidHome, 'platform-tools', 'adb'));
  }

  const home = process.env.HOME ?? homedir();
  if (home) {
    candidates.push(
      join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
      join(home, 'Android', 'Sdk', 'platform-tools', 'adb')
    );
  }

  for (const candidate of candidates) {
    if (canExecute(candidate)) {
      return { path: candidate, source: 'auto', candidates };
    }
  }

  return { path: 'adb', source: 'path', candidates: [...candidates, 'adb'] };
}

const resolvedAdb = resolveAdbPath();
export const ADB_PATH = resolvedAdb.path;
export const ADB_PATH_SOURCE = resolvedAdb.source;
export const ADB_PATH_CANDIDATES = resolvedAdb.candidates;
const serialEnv = process.env.ADB_SERIAL;
export const ADB_SERIAL =
  serialEnv && serialEnv.toLowerCase() !== 'auto' ? serialEnv : undefined;
export const ADB_TIMEOUT_MS = Number(process.env.ADB_TIMEOUT_MS ?? '15000');
const maxBufferMb = Number(process.env.ADB_MAX_BUFFER_MB ?? '10');
export const ADB_MAX_BUFFER = Math.max(1, maxBufferMb) * 1024 * 1024;
export const ADB_DEBUG = process.env.ADB_DEBUG === '1';

export const MCP_TRANSPORT = process.env.MCP_TRANSPORT ?? 'stdio';
export const MCP_HTTP_PORT = Number(process.env.PORT ?? '7332');
