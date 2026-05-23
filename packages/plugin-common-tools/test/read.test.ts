import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createReadTool } from '../src/tools/read'

const EXECUTE_OPTIONS = {
  abortSignal: new AbortController().signal,
  messages: [],
  toolCallId: 'test-call',
}

describe('createReadTool', () => {
  let testDir: string
  let filePath: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apeira-read-tool-'))
    filePath = path.join(testDir, 'sample.txt')
  })

  afterEach(async () => {
    await fs.rm(testDir, { force: true, recursive: true })
  })

  it('reads a limited number of lines from the beginning', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree\nfour\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, limit: 2 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('one\ntwo\n')
  })

  it('treats offset 1 as the first line when a limit is provided', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree\nfour\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, limit: 2, offset: 1 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('one\ntwo\n')
  })

  it('starts partial reads at the 1-indexed offset line', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree\nfour\nfive\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, limit: 2, offset: 3 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('three\nfour\n')
  })

  it('reads from offset through EOF when limit is omitted', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree\nfour\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, offset: 3 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('three\nfour\n')
  })

  it('returns an empty string when the offset is beyond EOF', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, offset: 10 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('')
  })

  it('preserves the final line when the file has no trailing newline', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, offset: 2 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('two\nthree')
  })

  it('returns an empty string for zero line limit', async () => {
    await fs.writeFile(filePath, 'one\ntwo\nthree\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, limit: 0, offset: 2 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('')
  })

  it('preserves multibyte utf-8 content in partial reads', async () => {
    await fs.writeFile(filePath, 'alpha\n你好\nemoji 😀\nomega\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, limit: 2, offset: 2 }, EXECUTE_OPTIONS))
      .resolves
      .toBe('你好\nemoji 😀\n')
  })

  it('rejects invalid line ranges', async () => {
    await fs.writeFile(filePath, 'one\ntwo\n', 'utf8')

    const tool = createReadTool()

    await expect(tool.execute({ filePath, offset: 0 }, EXECUTE_OPTIONS))
      .rejects
      .toThrow('offset must be a positive integer')
    await expect(tool.execute({ filePath, limit: -1 }, EXECUTE_OPTIONS))
      .rejects
      .toThrow('limit must be a non-negative integer')
  })
})
