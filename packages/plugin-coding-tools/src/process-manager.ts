import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type {
  ExecCommandInput,
  ExecCommandOutput,
  PermissionProfile,
  WriteStdinInput,
} from './types'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { basename } from 'node:path'

const DEFAULT_OUTPUT_TOKENS = 10_000
const TRANSCRIPT_LIMIT = 10 * 1024 * 1024

export type CommandWrapper = (options: SpawnCommandOptions) => Promise<SpawnDescriptor> | SpawnDescriptor

export interface SpawnCommandOptions {
  command: string
  cwd: string
  login?: boolean
  permissions: PermissionProfile
  shell?: string
  signal?: AbortSignal
}

export interface SpawnDescriptor {
  argv: string[]
  env?: NodeJS.ProcessEnv
}

interface Session {
  child: ChildProcessWithoutNullStreams
  exitCode?: number
  exitPromise: Promise<void>
  id: number
  killTimer?: ReturnType<typeof setTimeout>
  transcript: Transcript
}

class Transcript {
  private content = ''
  private totalCharacters = 0

  append(value: string) {
    this.totalCharacters += value.length
    this.content += value
    if (this.content.length > TRANSCRIPT_LIMIT) {
      const half = Math.floor(TRANSCRIPT_LIMIT / 2)
      this.content = `${this.content.slice(0, half)}\n... output truncated ...\n${this.content.slice(-half)}`
    }
  }

  drain(maxTokens = DEFAULT_OUTPUT_TOKENS) {
    const originalTokenCount = Math.ceil(this.totalCharacters / 4)
    const maxCharacters = Math.max(1, Math.floor(maxTokens)) * 4
    let output = this.content

    if (output.length > maxCharacters) {
      const half = Math.max(1, Math.floor((maxCharacters - 32) / 2))
      output = `${output.slice(0, half)}\n... output truncated ...\n${output.slice(-half)}`
    }

    this.content = ''
    this.totalCharacters = 0
    return { originalTokenCount, output }
  }
}

const delay = async (milliseconds: number) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, milliseconds)
  timer.unref?.()
})

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value ?? fallback))

const defaultShell = () => process.platform === 'win32'
  ? process.env.ComSpec ?? 'cmd.exe'
  : process.env.SHELL ?? '/bin/sh'

const nodeCommandWrapper: CommandWrapper = ({ command, login = true, shell = defaultShell() }) => {
  if (process.platform !== 'win32')
    return { argv: [shell, login ? '-lc' : '-c', command], env: process.env }

  const shellName = basename(shell).toLowerCase()
  if (shellName === 'pwsh' || shellName === 'pwsh.exe' || shellName === 'powershell' || shellName === 'powershell.exe') {
    return {
      argv: [shell, '-NoLogo', ...(login && shellName.startsWith('pwsh') ? ['-Login'] : []), '-Command', command],
      env: process.env,
    }
  }

  return { argv: [shell, '/d', '/s', '/c', command], env: process.env }
}

export class ProcessManager {
  private nextSessionId = 1
  private readonly sessions = new Map<number, Session>()
  private readonly wrapCommand: CommandWrapper

  constructor(wrapCommand: CommandWrapper = nodeCommandWrapper) {
    this.wrapCommand = wrapCommand
  }

  async exec(input: ExecCommandInput, options: Omit<SpawnCommandOptions, 'command' | 'login' | 'shell'>): Promise<ExecCommandOutput> {
    if (input.tty === true)
      throw new Error('tty: true is not supported by this backend. Provide a custom backend with PTY support.')

    const startedAt = Date.now()
    const session = await this.spawn({
      ...options,
      command: input.cmd,
      login: input.login,
      shell: input.shell,
    })
    this.sessions.set(session.id, session)

    await Promise.race([
      session.exitPromise,
      delay(clamp(input.yield_time_ms, 10_000, 250, 30_000)),
    ])

    const response = this.response(session, input.max_output_tokens, Date.now() - startedAt)
    if (session.exitCode != null)
      this.sessions.delete(session.id)
    return response
  }

  async run(
    command: string,
    options: Omit<SpawnCommandOptions, 'command'>,
    stdin?: string,
  ): Promise<{ exitCode: number, output: string }> {
    const session = await this.spawn({ ...options, command })
    if (stdin != null)
      session.child.stdin.end(stdin)
    else
      session.child.stdin.end()
    await session.exitPromise
    const { output } = session.transcript.drain(Number.MAX_SAFE_INTEGER)
    return { exitCode: session.exitCode ?? 1, output }
  }

  async stop() {
    const pending = [...this.sessions.values()]
    for (const session of pending)
      this.terminate(session)
    await Promise.allSettled(pending.map(async session => session.exitPromise))
    this.sessions.clear()
  }

  async write(input: WriteStdinInput): Promise<ExecCommandOutput> {
    const session = this.sessions.get(input.session_id)
    if (session == null)
      throw new Error(`Unknown or completed exec session: ${input.session_id}`)

    const chars = input.chars ?? ''
    if (chars.length > 0) {
      if (!session.child.stdin.writable)
        throw new Error(`stdin is closed for exec session: ${input.session_id}`)
      session.child.stdin.write(chars)
    }

    const startedAt = Date.now()
    const defaultYield = chars.length > 0 ? 250 : 5_000
    const maxYield = chars.length > 0 ? 30_000 : 300_000
    await Promise.race([
      session.exitPromise,
      delay(clamp(input.yield_time_ms, defaultYield, 250, maxYield)),
    ])

    const response = this.response(session, input.max_output_tokens, Date.now() - startedAt)
    if (session.exitCode != null)
      this.sessions.delete(session.id)
    return response
  }

  private response(session: Session, maxTokens: number | undefined, wallTime: number): ExecCommandOutput {
    const { originalTokenCount, output } = session.transcript.drain(maxTokens)
    return {
      ...(output.length > 0 ? { chunk_id: `${session.id}:${Date.now()}` } : {}),
      ...(session.exitCode != null ? { exit_code: session.exitCode } : { session_id: session.id }),
      ...(originalTokenCount > Math.ceil(output.length / 4) ? { original_token_count: originalTokenCount } : {}),
      output,
      wall_time_seconds: wallTime / 1000,
    }
  }

  private async spawn(options: SpawnCommandOptions): Promise<Session> {
    const descriptor = await this.wrapCommand(options)
    if (descriptor.argv.length === 0)
      throw new Error('Command wrapper returned an empty argv.')

    const child = spawn(descriptor.argv[0], descriptor.argv.slice(1), {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: descriptor.env ?? process.env,
      stdio: 'pipe',
      windowsHide: true,
    })
    const id = this.nextSessionId++
    const transcript = new Transcript()
    let resolveExit: () => void = () => {}
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const session: Session = {
      child,
      exitPromise,
      id,
      transcript,
    }

    child.stdout.on('data', chunk => transcript.append(String(chunk)))
    child.stderr.on('data', chunk => transcript.append(String(chunk)))
    child.once('error', (error) => {
      transcript.append(`Command failed to start: ${error.message}\n`)
      session.exitCode = 1
      resolveExit()
    })
    child.once('exit', (code, signal) => {
      if (session.killTimer != null)
        clearTimeout(session.killTimer)
      session.exitCode = code ?? (signal == null ? 1 : 128)
      resolveExit()
    })

    if (options.signal != null) {
      const abort = () => this.terminate(session)
      if (options.signal.aborted)
        abort()
      else
        options.signal.addEventListener('abort', abort, { once: true })
      void exitPromise.finally(() => options.signal?.removeEventListener('abort', abort))
    }

    return session
  }

  private terminate(session: Session) {
    if (session.exitCode != null || session.killTimer != null)
      return

    if (process.platform === 'win32' && session.child.pid != null) {
      const killer = spawn('taskkill' as const, ['/pid', String(session.child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('error', () => session.child.kill('SIGKILL'))
      killer.unref()
    }
    else {
      try {
        if (session.child.pid != null)
          process.kill(-session.child.pid, 'SIGTERM')
        else
          session.child.kill('SIGTERM')
      }
      catch {
        session.child.kill('SIGKILL')
      }
    }

    session.killTimer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && session.child.pid != null)
          process.kill(-session.child.pid, 'SIGKILL')
        else
          session.child.kill('SIGKILL')
      }
      catch {}
    }, 1_000)
    session.killTimer.unref?.()
  }
}

export { nodeCommandWrapper }
