import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type {
  BackendStartOptions,
  HostExecutor,
  ProcessSink,
  RunningProcess,
  SandboxCapabilityReport,
  SandboxProfile,
} from './types'

import process from 'node:process'

import { spawn } from 'node:child_process'

const write = async (child: ChildProcessWithoutNullStreams, data: string) => new Promise<void>((resolve, reject) => {
  child.stdin.write(data, error => error == null ? resolve() : reject(error))
})

const end = async (child: ChildProcessWithoutNullStreams) => new Promise<void>((resolve, reject) => {
  const onError = (error: Error) => reject(error)
  child.stdin.once('error', onError)
  child.stdin.end(() => {
    child.stdin.removeListener('error', onError)
    resolve()
  })
})

export const startNodeProcess = (
  argv: readonly [string, ...string[]],
  options: BackendStartOptions,
  sink: ProcessSink,
  spawnEnv: NodeJS.ProcessEnv,
): RunningProcess => {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: spawnEnv,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  child.stdin.on('error', () => undefined)
  child.stdout.on('data', (chunk: Buffer) => sink.stdout(chunk))
  child.stderr.on('data', (chunk: Buffer) => sink.stderr(chunk))

  const completed = new Promise<{ exitCode?: number, signal?: NodeJS.Signals }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode, signal) => resolve({
      exitCode: exitCode ?? undefined,
      signal: signal ?? undefined,
    }))
  })

  if (options.input != null) {
    void write(child, options.input)
      .then(async () => end(child))
      .catch(() => child.kill('SIGTERM'))
  }

  return {
    completed,
    end: async () => end(child),
    kill: signal => child.kill(signal ?? 'SIGTERM'),
    pid: child.pid,
    write: async data => write(child, data),
  }
}

const hostCapabilityReport = (): SandboxCapabilityReport => ({
  errors: [],
  platform: process.platform,
  supported: true,
  warnings: ['Host execution is not sandboxed.'],
})

export const createHostExecutor = (options: { shell?: string } = {}): HostExecutor => ({
  check: async () => hostCapabilityReport(),
  name: 'host',
  start: async (request, _profile: Readonly<SandboxProfile>, sink) => {
    const shell = request.shell ?? options.shell ?? process.env.SHELL ?? '/bin/bash'
    return startNodeProcess(
      [shell, '-lc', request.command],
      request,
      sink,
      { ...process.env, ...request.env },
    )
  },
})
