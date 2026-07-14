import { Buffer } from 'node:buffer'
import { open, readFile } from 'node:fs/promises'

import { rawTool } from '@apeira/core'

interface PartialReadState {
  currentLine: number
  result: string
  returnedLines: number
}

const assertValidRange = (offset?: number, limit?: number) => {
  if (offset != null && (!Number.isInteger(offset) || offset < 1))
    throw new Error('offset must be a positive integer')

  if (limit != null && (!Number.isInteger(limit) || limit < 0))
    throw new Error('limit must be a non-negative integer')
}

const appendLine = (
  state: PartialReadState,
  line: string,
  startLine: number,
  maxLines: number,
) => {
  if (state.currentLine >= startLine && state.returnedLines < maxLines) {
    state.result += line
    state.returnedLines += 1
  }

  state.currentLine += 1
}

const appendLines = (
  state: PartialReadState,
  lines: string[],
  startLine: number,
  maxLines: number,
) => {
  for (const line of lines) {
    if (state.returnedLines >= maxLines)
      break

    appendLine(state, `${line}\n`, startLine, maxLines)
  }
}

const readPartialFile = async (filePath: string, offset?: number, limit?: number) => {
  if (limit === 0)
    return ''

  const handle = await open(filePath, 'r')

  try {
    const startLine = offset ?? 1
    const maxLines = limit ?? Number.POSITIVE_INFINITY
    const decoder = new TextDecoder()
    const state: PartialReadState = {
      currentLine: 1,
      result: '',
      returnedLines: 0,
    }
    const buffer = Buffer.alloc(65536)
    let partialLine = ''

    while (true) {
      if (state.returnedLines >= maxLines)
        break

      const { bytesRead } = await handle.read({ buffer, position: undefined })
      if (bytesRead === 0)
        break

      const content = partialLine + decoder.decode(buffer.subarray(0, bytesRead), { stream: true })
      const lines = content.split('\n')

      partialLine = lines.pop() ?? ''
      appendLines(state, lines, startLine, maxLines)
    }

    const rest = decoder.decode()
    if (rest.length > 0)
      partialLine += rest

    if (partialLine.length > 0 && state.returnedLines < maxLines)
      appendLine(state, partialLine, startLine, maxLines)

    return state.result
  }
  finally {
    await handle.close()
  }
}

export const createReadTool = () => rawTool({
  description: 'Read the contents of a file from the local filesystem. Supports partial reads with offset and limit for large files.',
  execute: async (input: unknown) => {
    const { filePath, limit, offset } = input as { filePath: string, limit?: number, offset?: number }

    assertValidRange(offset, limit)

    if (offset != null || limit != null)
      return readPartialFile(filePath, offset, limit)

    return readFile(filePath, 'utf-8')
  },
  name: 'read',
  parameters: {
    properties: {
      filePath: { description: 'The absolute path to the file to read.', type: 'string' },
      limit: { description: 'Maximum number of lines to read.', type: 'number' },
      offset: { description: 'Line number to start reading from (1-indexed).', type: 'number' },
    },
    required: ['filePath'],
    title: 'read_parameters',
    type: 'object',
  },
})
