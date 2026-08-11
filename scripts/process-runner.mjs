import { spawnSync } from 'node:child_process';

export function resolveProcessInvocation(
  command,
  args,
  {
    platform = process.platform,
    npmExecPath = process.env.npm_execpath,
    nodeExecPath = process.execPath,
  } = {},
) {
  if (command !== 'pnpm') return { command, args, shell: false };
  if (npmExecPath) {
    return { command: nodeExecPath, args: [npmExecPath, ...args], shell: false };
  }
  if (platform === 'win32') return { command: 'pnpm.cmd', args, shell: true };
  return { command, args, shell: false };
}

export function runProcess(command, args, additions = {}) {
  const invocation = resolveProcessInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...additions },
    shell: invocation.shell,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function runPnpm(args, additions = {}) {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (!pnpmEntrypoint) {
    throw new Error('Run this script through pnpm so npm_execpath is available.');
  }
  runProcess('pnpm', args, additions);
}
