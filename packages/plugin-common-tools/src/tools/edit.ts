import { readFile, writeFile } from 'node:fs/promises'

import { rawTool } from '@apeira/core'

export const createEditTool = () => rawTool({
  description: 'Edit a file by finding and replacing text. Uses exact string matching. Returns a diff of the change.',
  execute: async (input: unknown) => {
    const { filePath, newString, oldString, replaceAll } = input as {
      filePath: string
      newString: string
      oldString: string
      replaceAll?: boolean
    }

    const original = await readFile(filePath, 'utf-8')

    let count = 0
    let updated: string

    if (replaceAll) {
      const parts = original.split(oldString)
      count = parts.length - 1

      if (count === 0)
        throw new Error(`Could not find "${oldString}" in ${filePath}`)

      updated = parts.join(newString)
    }
    else {
      const index = original.indexOf(oldString)

      if (index === -1)
        throw new Error(`Could not find "${oldString}" in ${filePath}`)

      count = 1
      updated = original.slice(0, index) + newString + original.slice(index + oldString.length)
    }

    await writeFile(filePath, updated, 'utf-8')

    return `Applied ${count} edit(s) to ${filePath}`
  },
  name: 'edit',
  parameters: {
    properties: {
      filePath: { description: 'The absolute path to the file to edit.', type: 'string' },
      newString: { description: 'The new text to replace with.', type: 'string' },
      oldString: { description: 'The existing text to replace. Must match exactly once in the file.', type: 'string' },
      replaceAll: { description: 'Replace all occurrences instead of just the first.', type: 'boolean' },
    },
    required: ['filePath', 'oldString', 'newString'],
    title: 'edit_parameters',
    type: 'object',
  },
})
