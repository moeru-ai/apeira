import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { jsonl } from '../src/jsonl'

describe('jsonl', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apeira-jsonl-'))
    path = join(dir, 'store.jsonl')
  })

  afterEach(async () => {
    // node will clean up the temp dir on restart; no need to remove
  })

  it('append and read', async () => {
    const storage = jsonl<string>({ path })

    await storage.append('a', 'b')
    await storage.append('c')

    expect(await storage.read()).toEqual(['a', 'b', 'c'])
  })

  it('writes newline-delimited json', async () => {
    const storage = jsonl<number>({ path })

    await storage.append(1, 2, 3)

    const raw = await readFile(path, 'utf-8')
    expect(raw).toBe('1\n2\n3\n')
  })

  it('clears the file', async () => {
    const storage = jsonl<string>({ path })

    await storage.append('a')
    await storage.clear()

    expect(await storage.read()).toEqual([])
    expect(await readFile(path, 'utf-8')).toBe('')
  })

  it('resets to initial', async () => {
    const storage = jsonl<number>({ initial: [1, 2], path })

    await storage.append(3, 4, 5)
    await storage.reset()

    expect(await storage.read()).toEqual([1, 2])
  })

  it('returns initial before any append', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    expect(await storage.read()).toEqual(['x', 'y'])
  })

  it('append preserves initial', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    await storage.append('z')

    expect(await storage.read()).toEqual(['x', 'y', 'z'])
  })

  it('does not re-initialize after clear', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    await storage.append('z')
    await storage.clear()
    await storage.append('a')

    expect(await storage.read()).toEqual(['a'])
  })

  it('ignores corrupt lines', async () => {
    const storage = jsonl<string>({ path })

    await storage.append('a', 'b')
    await storage.append('c')

    const raw = await readFile(path, 'utf-8')
    await writeFile(path, `${raw}{broken line\n`, 'utf-8')

    expect(await storage.read()).toEqual(['a', 'b', 'c'])
  })
})
