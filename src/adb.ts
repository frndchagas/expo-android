import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ADB_DEBUG,
  ADB_MAX_BUFFER,
  ADB_PATH,
  ADB_PATH_CANDIDATES,
  ADB_PATH_SOURCE,
  ADB_SERIAL,
  ADB_TIMEOUT_MS,
} from './config.js';

const execFileAsync = promisify(execFile);

type ExecOptions = ExecFileOptions & {
  encoding?: BufferEncoding | 'buffer' | null;
  serial?: string | null;
};

type AdbDevice = {
  serial: string;
  state: string;
  details: string;
};

let resolvedSerial: string | null | undefined;
let resolvingSerial: Promise<string | null> | null = null;

function logDebug(message: string) {
  if (!ADB_DEBUG) return;
  console.error(`[expo-android] ${message}`);
}

function toText(value: string | Buffer) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}

function parseDevicesOutput(output: string): AdbDevice[] {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(1).map((line) => {
    const [serial, state, ...rest] = line.split(/\s+/);
    return { serial, state, details: rest.join(' ') };
  });
}

async function adbExecRaw(args: string[], options: ExecOptions = {}) {
  const { serial: _serial, ...execOptions } = options;
  return execFileAsync(ADB_PATH, args, {
    timeout: ADB_TIMEOUT_MS,
    maxBuffer: ADB_MAX_BUFFER,
    ...execOptions,
  });
}

export async function adbExec(args: string[], options: ExecOptions = {}) {
  const serial =
    options.serial === null
      ? undefined
      : options.serial ?? (await resolveAdbSerial());
  const finalArgs = serial ? ['-s', serial, ...args] : args;
  return adbExecRaw(finalArgs, options);
}

export async function adbShell(command: string) {
  return adbExec(['shell', command]);
}

export async function adbExecOut(args: string[]) {
  return adbExec(['exec-out', ...args], { encoding: 'buffer' });
}

export async function adbListDevices() {
  const { stdout } = await adbExecRaw(['devices', '-l'], { serial: null });
  return parseDevicesOutput(toText(stdout));
}

export async function resolveAdbSerial({ strict = true } = {}) {
  if (ADB_SERIAL) return ADB_SERIAL;
  if (resolvedSerial !== undefined) return resolvedSerial;
  if (!resolvingSerial) {
    resolvingSerial = (async () => {
      const devices = await adbListDevices();
      const online = devices.filter((device) => device.state === 'device');

      if (online.length === 1) {
        resolvedSerial = online[0].serial;
        logDebug(`Auto-selected device serial ${resolvedSerial}.`);
        return resolvedSerial;
      }

      resolvedSerial = null;
      if (online.length === 0) {
        logDebug('No adb devices detected.');
        return null;
      }

      if (strict) {
        const serials = online.map((device) => device.serial).join(', ');
        throw new Error(
          `Multiple devices detected (${serials}). Set ADB_SERIAL to target a device.`
        );
      }

      return null;
    })();
  }

  try {
    return await resolvingSerial;
  } finally {
    resolvingSerial = null;
  }
}

export async function getAdbVersion() {
  const { stdout } = await adbExecRaw(['version'], { serial: null });
  return toText(stdout).trim();
}

function formatAdbNotFoundMessage(error: unknown) {
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : 'UNKNOWN';
  const candidates = ADB_PATH_CANDIDATES.join('\n  - ');
  return [
    `ADB executable not found (source: ${ADB_PATH_SOURCE}, path: ${ADB_PATH}).`,
    `Error code: ${errorCode}`,
    'Fix:',
    '  - Set ADB_PATH to your adb binary, or',
    '  - Add platform-tools to PATH, or',
    '  - Set ANDROID_HOME / ANDROID_SDK_ROOT.',
    'Candidates tried:',
    `  - ${candidates}`,
  ].join('\n');
}

export async function assertAdbAvailable() {
  try {
    await adbExecRaw(['version'], { serial: null });
  } catch (error) {
    throw new Error(formatAdbNotFoundMessage(error));
  }
}
