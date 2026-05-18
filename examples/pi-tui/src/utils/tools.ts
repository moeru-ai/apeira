/* eslint-disable antfu/no-top-level-await */
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { relativeToWorkspace, resolveWorkspacePath } from './workspace'

const MAX_OUTPUT_BYTES = 64 * 1024

const truncateOutput = (value: string) => {
  if (Buffer.byteLength(value, 'utf8') <= MAX_OUTPUT_BYTES)
    return { text: value, truncated: false }

  let text = value
  while (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES)
    text = text.slice(0, Math.max(0, Math.floor(text.length * 0.9)))

  return {
    text: `${text}\n[output truncated]`,
    truncated: true,
  }
}

const runBashCommand = async (command: string, cwd: string, timeoutMs: number) =>
  new Promise<{
    code: null | number
    didTimeOut: boolean
    signal: NodeJS.Signals | null
    stderr: string
    stdout: string
  }>((resolve, reject) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let didTimeOut = false

    const appendChunk = (
      current: string,
      chunk: Uint8Array,
    ) => {
      if (Buffer.byteLength(current, 'utf8') >= MAX_OUTPUT_BYTES)
        return { text: current, truncated: true }

      let next = `${current}${Buffer.from(chunk).toString('utf8')}`
      let truncated = false

      while (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
        next = next.slice(0, Math.max(0, Math.floor(next.length * 0.95)))
        truncated = true
      }

      return { text: next, truncated }
    }

    child.stdout.on('data', (chunk: Uint8Array) => {
      const next = appendChunk(stdout, chunk)
      stdout = next.text
      stdoutTruncated = stdoutTruncated || next.truncated
    })
    child.stderr.on('data', (chunk: Uint8Array) => {
      const next = appendChunk(stderr, chunk)
      stderr = next.text
      stderrTruncated = stderrTruncated || next.truncated
    })
    child.on('error', reject)

    const timer = setTimeout(() => {
      didTimeOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        code,
        didTimeOut,
        signal,
        stderr: stderrTruncated ? `${stderr}\n[output truncated]` : stderr,
        stdout: stdoutTruncated ? `${stdout}\n[output truncated]` : stdout,
      })
    })
  })

export const listFilesTool = await tool({
  description: 'List files and directories inside the current workspace.',
  execute: async ({ maxEntries, recursive, targetPath }) => {
    const safeTargetPath = targetPath ?? '.'
    const safeMaxEntries = maxEntries ?? 80
    const safeRecursive = recursive ?? false
    const startPath = await resolveWorkspacePath(safeTargetPath)
    const stats = await fs.stat(startPath)

    if (!stats.isDirectory())
      throw new Error(`${safeTargetPath} is not a directory`)

    const results: string[] = []

    const visit = async (directory: string) => {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))

      for (const entry of entries) {
        if (results.length >= safeMaxEntries)
          return

        const entryPath = path.join(directory, entry.name)
        const label = `${relativeToWorkspace(entryPath)}${entry.isDirectory() ? '/' : ''}`
        results.push(label)

        if (safeRecursive && entry.isDirectory())
          await visit(entryPath)
      }
    }

    await visit(startPath)

    return {
      entries: results,
      root: relativeToWorkspace(startPath),
      truncated: results.length >= safeMaxEntries,
    }
  },
  name: 'list_files',
  parameters: z.object({
    maxEntries: z.number().int().min(1).max(200).default(80).describe('Maximum number of entries to return.'),
    recursive: z.boolean().default(false).describe('Whether to recurse into subdirectories.'),
    targetPath: z.string().default('.').describe('Directory path relative to the workspace root.'),
  }),
})

export const readFileTool = await tool({
  description: 'Read a UTF-8 text file from the current workspace.',
  execute: async ({ endLine, startLine, targetPath }) => {
    const safeTargetPath = targetPath ?? '.'
    const safeStartLine = startLine ?? 1
    const safeEndLine = endLine ?? 200
    const absolutePath = await resolveWorkspacePath(safeTargetPath)
    const stats = await fs.stat(absolutePath)

    if (!stats.isFile())
      throw new Error(`${safeTargetPath} is not a file`)

    const content = await fs.readFile(absolutePath, 'utf8')
    const lines = content.split('\n')
    const firstLine = Math.max(1, safeStartLine)
    const lastLine = Math.min(lines.length, safeEndLine)

    if (lastLine < firstLine)
      throw new Error(`Invalid line range: ${firstLine}-${lastLine}`)

    return {
      content: lines.slice(firstLine - 1, lastLine).join('\n'),
      endLine: lastLine,
      path: relativeToWorkspace(absolutePath),
      startLine: firstLine,
      totalLines: lines.length,
    }
  },
  name: 'read_file',
  parameters: z.object({
    endLine: z.number().int().min(1).max(4000).default(200).describe('Last line number to include.'),
    startLine: z.number().int().min(1).max(4000).default(1).describe('First line number to include.'),
    targetPath: z.string().describe('File path relative to the workspace root.'),
  }),
})

export const writeFileTool = await tool({
  description: 'Write a UTF-8 text file in the current workspace, creating parent directories if needed.',
  execute: async ({ content, targetPath }) => {
    const safeTargetPath = targetPath ?? '.'
    const absolutePath = await resolveWorkspacePath(safeTargetPath, true)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content ?? '', 'utf8')

    return {
      bytes: Buffer.byteLength(content ?? '', 'utf8'),
      path: relativeToWorkspace(absolutePath),
      status: 'written',
    }
  },
  name: 'write_file',
  parameters: z.object({
    content: z.string().describe('Full UTF-8 file contents to write.'),
    targetPath: z.string().describe('File path relative to the workspace root.'),
  }),
})

export const editFileTool = await tool({
  description: 'Edit a UTF-8 text file by replacing an exact string match with new content.',
  execute: async ({ newString, oldString, replaceAll, targetPath }) => {
    const safeTargetPath = targetPath ?? '.'
    const absolutePath = await resolveWorkspacePath(safeTargetPath)
    const content = await fs.readFile(absolutePath, 'utf8')

    if (!content.includes(oldString))
      throw new Error(`Could not find the target text in ${safeTargetPath}`)

    const occurrences = content.split(oldString).length - 1

    if (occurrences > 1 && !replaceAll)
      throw new Error(`Found ${occurrences} matches in ${safeTargetPath}; set replaceAll=true or provide a more specific oldString`)

    const nextContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString)

    await fs.writeFile(absolutePath, nextContent, 'utf8')

    return {
      path: relativeToWorkspace(absolutePath),
      replacements: replaceAll ? occurrences : 1,
      status: 'edited',
    }
  },
  name: 'edit_file',
  parameters: z.object({
    newString: z.string().describe('Replacement text.'),
    oldString: z.string().describe('Exact text to replace.'),
    replaceAll: z.boolean().default(false).describe('Whether to replace all occurrences instead of exactly one.'),
    targetPath: z.string().describe('File path relative to the workspace root.'),
  }),
})

export const bashTool = await tool({
  description: 'Run a bash command in the current workspace and return stdout, stderr, and exit status.',
  execute: async ({ command, targetPath, timeoutMs }) => {
    const safeTargetPath = targetPath ?? '.'
    const safeTimeoutMs = timeoutMs ?? 15_000
    const cwd = await resolveWorkspacePath(safeTargetPath)
    const stats = await fs.stat(cwd)

    if (!stats.isDirectory())
      throw new Error(`${safeTargetPath} is not a directory`)

    const result = await runBashCommand(command, cwd, safeTimeoutMs)
    const stdout = truncateOutput(result.stdout)
    const stderr = truncateOutput(result.stderr)

    return {
      cwd: relativeToWorkspace(cwd),
      exitCode: result.code,
      signal: result.signal,
      stderr: stderr.text,
      stderrTruncated: stderr.truncated,
      stdout: stdout.text,
      stdoutTruncated: stdout.truncated,
      timedOut: result.didTimeOut,
    }
  },
  name: 'bash',
  parameters: z.object({
    command: z.string().describe('Bash command to run.'),
    targetPath: z.string().default('.').describe('Working directory relative to the workspace root.'),
    timeoutMs: z.number().int().min(100).max(120_000).default(15_000).describe('Timeout in milliseconds before the command is terminated.'),
  }),
})
