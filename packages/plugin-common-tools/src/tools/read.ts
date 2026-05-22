import { Buffer } from 'node:buffer'
import { open, readFile } from 'node:fs/promises'

import { rawTool } from '@xsai/tool'

export const createReadTool = () => rawTool({
  description: 'Read the contents of a file from the local filesystem. Supports partial reads with offset and limit for large files.',
  execute: async (input: unknown) => {
    const { filePath, limit, offset } = input as { filePath: string, limit?: number, offset?: number }

    if (offset != null || limit != null) {
      const handle = await open(filePath, 'r')

      try {
        let remainingLines = limit ?? Number.POSITIVE_INFINITY
        let result = ''
        const buffer = Buffer.alloc(65536)
        let partialLine = ''

        while (remainingLines > 0) {
          const { bytesRead } = await handle.read({ buffer, position: undefined })
          if (bytesRead === 0)
            break

          const content = partialLine + buffer.toString('utf-8', 0, bytesRead)
          const lines = content.split('\n')

          partialLine = lines.pop() ?? ''

          for (const line of lines) {
            if (remainingLines <= 0)
              break
            result += `${line}\n`
            remainingLines--
          }
        }

        return result
      }
      finally {
        await handle.close()
      }
    }

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
