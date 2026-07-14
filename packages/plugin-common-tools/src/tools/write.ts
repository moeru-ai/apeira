import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { rawTool } from '@apeira/core'

export const createWriteTool = () => rawTool({
  description: 'Write content to a file, creating parent directories if needed. Can append to existing files.',
  execute: async (input: unknown) => {
    const { append, content, filePath } = input as {
      append?: boolean
      content: string
      filePath: string
    }

    await mkdir(dirname(filePath), { recursive: true })

    if (append) {
      await appendFile(filePath, content, 'utf-8')
      return `Appended ${content.length} characters to ${filePath}`
    }

    await writeFile(filePath, content, 'utf-8')
    return `Wrote ${content.length} characters to ${filePath}`
  },
  name: 'write',
  parameters: {
    properties: {
      append: { description: 'If true, append to the file instead of overwriting.', type: 'boolean' },
      content: { description: 'The content to write to the file.', type: 'string' },
      filePath: { description: 'The absolute path to the file to write.', type: 'string' },
    },
    required: ['content', 'filePath'],
    title: 'write_parameters',
    type: 'object',
  },
})
