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
let serialOverride: string | null | undefined;

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

type RequestedSerial = {
  serial: string | null;
  source: 'override' | 'env' | null;
};

type AdbSerialState = {
  serial: string | null;
  source: 'override' | 'env' | 'auto' | 'fallback' | 'none';
  requestedSerial: string | null;
  requestedSerialSource: RequestedSerial['source'];
  warning?: string;
  error?: string;
};

function getRequestedSerial(): RequestedSerial {
  if (serialOverride !== undefined) {
    return { serial: serialOverride, source: 'override' };
  }
  if (ADB_SERIAL) {
    return { serial: ADB_SERIAL, source: 'env' };
  }
  return { serial: null, source: null };
}

async function assertSerialAvailable(serial: string) {
  const devices = await adbListDevices();
  const online = devices.filter((device) => device.state === 'device');
  if (online.some((device) => device.serial === serial)) return;
  const available = online.map((device) => device.serial).join(', ') || 'none';
  throw new Error(
    `Device ${serial} not found. Available devices: ${available}.`
  );
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
  let serial: string | null | undefined;
  if (options.serial === null) {
    serial = undefined;
  } else if (typeof options.serial === 'string' && options.serial.trim() !== '') {
    const explicitSerial = options.serial.trim();
    await assertSerialAvailable(explicitSerial);
    serial = explicitSerial;
  } else {
    serial = await resolveAdbSerial();
  }
  const finalArgs = serial ? ['-s', serial, ...args] : args;
  return adbExecRaw(finalArgs, options);
}

export async function adbShell(command: string, options: ExecOptions = {}) {
  return adbExec(['shell', command], options);
}

export async function adbExecOut(args: string[], options: ExecOptions = {}) {
  return adbExec(['exec-out', ...args], { encoding: 'buffer', ...options });
}

export async function adbListDevices() {
  const { stdout } = await adbExecRaw(['devices', '-l'], { serial: null });
  return parseDevicesOutput(toText(stdout));
}

async function computeAdbSerialState({
  strict,
}: {
  strict: boolean;
}): Promise<AdbSerialState> {
  const { serial: requestedSerial, source: requestedSerialSource } =
    getRequestedSerial();
  const devices = await adbListDevices();
  const online = devices.filter((device) => device.state === 'device');
  const availableSerials = online.map((device) => device.serial);

  const baseState: AdbSerialState = {
    serial: null,
    source: 'none',
    requestedSerial,
    requestedSerialSource,
  };

  if (requestedSerial) {
    if (availableSerials.includes(requestedSerial)) {
      return {
        ...baseState,
        serial: requestedSerial,
        source: requestedSerialSource ?? 'env',
      };
    }

    if (online.length === 1) {
      const fallbackSerial = online[0].serial;
      return {
        ...baseState,
        serial: fallbackSerial,
        source: 'fallback',
        warning: `Requested device ${requestedSerial} not found. Falling back to ${fallbackSerial}.`,
      };
    }

    const available = availableSerials.length
      ? availableSerials.join(', ')
      : 'none';
    const message =
      online.length === 0
        ? `Requested device ${requestedSerial} not found and no devices are connected.`
        : `Requested device ${requestedSerial} not found. Available devices: ${available}.`;
    if (strict) {
      throw new Error(message);
    }
    return { ...baseState, error: message };
  }

  if (online.length === 1) {
    return {
      ...baseState,
      serial: online[0].serial,
      source: 'auto',
    };
  }

  const message =
    online.length === 0
      ? 'No adb devices detected. Start an emulator or connect a device.'
      : `Multiple devices detected (${availableSerials.join(
          ', '
        )}). Set ADB_SERIAL or use setDevice.`;
  if (strict) {
    throw new Error(message);
  }
  return { ...baseState, error: message };
}

export async function resolveAdbSerial({ strict = true } = {}) {
  if (resolvedSerial !== undefined && strict) {
    return resolvedSerial;
  }
  if (!resolvingSerial) {
    resolvingSerial = (async () => {
      const state = await computeAdbSerialState({ strict });
      resolvedSerial = state.serial;
      if (state.warning) {
        logDebug(state.warning);
      }
      return state.serial;
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

export async function getAdbSerialState({ strict = false } = {}) {
  try {
    return await computeAdbSerialState({ strict });
  } catch (error) {
    const { serial: requestedSerial, source: requestedSerialSource } =
      getRequestedSerial();
    return {
      serial: null,
      source: 'none',
      requestedSerial,
      requestedSerialSource,
      error: error instanceof Error ? error.message : String(error),
    } satisfies AdbSerialState;
  }
}

export function setAdbSerialOverride(serial?: string | null) {
  if (serial === undefined) {
    serialOverride = undefined;
    resolvedSerial = undefined;
    return;
  }
  if (serial === null) {
    serialOverride = null;
    resolvedSerial = undefined;
    return;
  }
  const trimmed = serial.trim();
  serialOverride = trimmed.toLowerCase() === 'auto' ? null : trimmed;
  resolvedSerial = undefined;
}
