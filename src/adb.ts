import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ADB_MAX_BUFFER,
  ADB_PATH,
  ADB_SERIAL,
  ADB_TIMEOUT_MS,
} from './config.js';

const execFileAsync = promisify(execFile);

type ExecOptions = ExecFileOptions & {
  encoding?: BufferEncoding | 'buffer' | null;
};

function withSerial(args: string[]) {
  if (!ADB_SERIAL) return args;
  return ['-s', ADB_SERIAL, ...args];
}

export async function adbExec(args: string[], options: ExecOptions = {}) {
  return execFileAsync(ADB_PATH, withSerial(args), {
    timeout: ADB_TIMEOUT_MS,
    maxBuffer: ADB_MAX_BUFFER,
    ...options,
  });
}

export async function adbShell(command: string) {
  return adbExec(['shell', command]);
}

export async function adbExecOut(args: string[]) {
  return adbExec(['exec-out', ...args], { encoding: 'buffer' });
}
