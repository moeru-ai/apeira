import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { Buffer } from 'node:buffer'

export const workspaceRoot = path.resolve(process.env.APEIRA_CWD ?? process.cwd())
export const model = process.env.APEIRA_MODEL ?? 'qwen3.5:0.8b'
export const baseURL = process.env.APEIRA_BASE_URL ?? 'http://localhost:11434/v1'
export const apiKey = process.env.OPENAI_API_KEY ?? process.env.APEIRA_API_KEY ?? 'ollama'
export const agentName = 'apeira-pi-tui'

const MAX_AGENTS_BYTES = 64 * 1024
const PROJECT_ROOT_MARKERS = ['.git']
const AGENTS_FILENAMES = ['AGENTS.override.md', 'AGENTS.md']

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath)
    return true
  }
  catch {
    return false
  }
}

const findProjectRoot = async (cwd: string) => {
  let current = cwd

  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await fileExists(path.join(current, marker)))
        return current
    }

    const parent = path.dirname(current)
    if (parent === current)
      return cwd

    current = parent
  }
}

const dirsFromRootToCwd = (root: string, cwd: string) => {
  const dirs = [cwd]
  let current = cwd

  while (current !== root) {
    const parent = path.dirname(current)
    if (parent === current)
      break

    current = parent
    dirs.push(current)
  }

  return dirs.reverse()
}

// eslint-disable-next-line sonarjs/cognitive-complexity
const readAgentsFiles = async () => {
  const root = await findProjectRoot(workspaceRoot)
  const files: Array<{ content: string, path: string }> = []
  let remainingBytes = MAX_AGENTS_BYTES

  for (const dir of dirsFromRootToCwd(root, workspaceRoot)) {
    for (const filename of AGENTS_FILENAMES) {
      const filePath = path.join(dir, filename)
      if (!(await fileExists(filePath)))
        continue

      const rawContent = await fs.readFile(filePath, 'utf8')
      const content = remainingBytes <= 0
        ? ''
        : Buffer.byteLength(rawContent, 'utf8') > remainingBytes
          ? rawContent.slice(0, remainingBytes)
          : rawContent

      if (content.trim().length > 0) {
        files.push({ content, path: filePath })
        remainingBytes -= Buffer.byteLength(content, 'utf8')
      }
      break
    }
  }

  return files
}

const formatProjectInstructions = (files: Array<{ content: string, path: string }>) => {
  if (files.length === 0)
    return ''

  return [
    '<project_context>',
    'Project instructions from AGENTS files. Later files are more specific when instructions conflict.',
    ...files.map(file => [
      `<project_instructions path="${file.path}">`,
      file.content.trim(),
      '</project_instructions>',
    ].join('\n')),
    '</project_context>',
  ].join('\n\n')
}

// eslint-disable-next-line antfu/no-top-level-await
const agentsInstructions = formatProjectInstructions(await readAgentsFiles())

export const instructions = [
  'You are a concise coding assistant running in the Apeira pi-tui example.',
  '',
  'Rules:',
  '- Be brief, direct, and implementation-focused.',
  '- Use workspace tools for file reads, edits, and commands; prefer rg/rg --files for search.',
  '- Show file paths clearly when discussing code.',
  '- Do not overwrite or revert user changes unless explicitly asked.',
  '- Keep edits scoped; default to ASCII and add comments only when they clarify non-obvious code.',
  '- If the user asks for a review, lead with bugs, regressions, risks, and missing tests.',
  '',
  `Workspace root: ${workspaceRoot}`,
  agentsInstructions,
].filter(Boolean).join('\n')
