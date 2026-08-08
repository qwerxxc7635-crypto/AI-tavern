import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const separator = process.argv.indexOf('--');
const outputFlag = process.argv.indexOf('--output');
if (
  separator < 0 ||
  outputFlag < 0 ||
  outputFlag + 1 >= separator ||
  separator + 1 >= process.argv.length
) {
  throw new Error('Usage: node scripts/run-with-evidence.mjs --output <file> -- <command> [args]');
}

const output = resolve(process.argv[outputFlag + 1]);
const requestedCommand = process.argv[separator + 1];
const commandArgs = process.argv.slice(separator + 2);
const command =
  process.platform === 'win32' && requestedCommand === 'pnpm' ? 'pnpm.cmd' : requestedCommand;
const startedAt = new Date().toISOString();
const stdout = [];
const stderr = [];
let spawnError;

const child = spawn(command, commandArgs, { env: process.env, shell: false });
child.stdout.on('data', (chunk) => {
  stdout.push(chunk);
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  stderr.push(chunk);
  process.stderr.write(chunk);
});
child.on('error', (error) => {
  spawnError = error;
});
child.on('close', (code, signal) => {
  const exitCode = code ?? 127;
  const errorText = spawnError === undefined ? '' : `${spawnError.name}: ${spawnError.message}\n`;
  const record = {
    schemaVersion: 1,
    command: [requestedCommand, ...commandArgs],
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode,
    signal,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: `${Buffer.concat(stderr).toString('utf8')}${errorText}`,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.exitCode = exitCode;
});
