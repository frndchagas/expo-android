export const ADB_PATH = process.env.ADB_PATH ?? 'adb';
export const ADB_SERIAL = process.env.ADB_SERIAL;
export const ADB_TIMEOUT_MS = Number(process.env.ADB_TIMEOUT_MS ?? '15000');
const maxBufferMb = Number(process.env.ADB_MAX_BUFFER_MB ?? '10');
export const ADB_MAX_BUFFER = Math.max(1, maxBufferMb) * 1024 * 1024;

export const MCP_TRANSPORT = process.env.MCP_TRANSPORT ?? 'stdio';
export const MCP_HTTP_PORT = Number(process.env.PORT ?? '7332');
