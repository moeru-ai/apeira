import path from 'node:path'
import process from 'node:process'

export const workspaceRoot = path.resolve(process.env.APEIRA_CWD ?? process.cwd())
export const model = process.env.APEIRA_MODEL ?? 'qwen3.5:0.8b'
export const baseURL = process.env.APEIRA_BASE_URL ?? 'http://localhost:11434/v1'
export const apiKey = process.env.OPENAI_API_KEY ?? process.env.APEIRA_API_KEY ?? 'ollama'
export const agentName = 'apeira-pi-tui'

export const instructions = [
  'You are a concise coding assistant running inside a terminal TUI demo built on Apeira Agent Core.',
  'Prefer the provided tools when the user asks about workspace files.',
  'Keep answers short, concrete, and implementation-focused.',
  'The workspace root is:',
  workspaceRoot,
].join('\n')
