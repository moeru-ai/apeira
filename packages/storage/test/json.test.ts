import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { json } from '../src/json'

describe('json', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apeira-json-'))
    path = join(dir, 'store.json')
  })

  afterEach(async () => {
    // node will clean up the temp dir on restart; no need to remove
  })

  it('append and read', async () => {
    const storage = json<string>({ path })

    await storage.append('a', 'b')
    await storage.append('c')

    expect(await storage.read()).toEqual(['a', 'b', 'c'])
  })

  it('serializes concurrent appends to the same path', async () => {
    const first = json<number>({ path })
    const second = json<number>({ path })

    await Promise.all(
      Array.from({ length: 20 }, async (_, index) =>
        (index % 2 === 0 ? first : second).append(index)),
    )

    expect([...(await first.read())].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index))
  })

  it('writes a formatted json array', async () => {
    const storage = json<number>({ path })

    await storage.append(1, 2, 3)

    const raw = await readFile(path, 'utf-8')
    expect(raw).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('clears the file', async () => {
    const storage = json<string>({ path })

    await storage.append('a')
    await storage.clear()

    expect(await storage.read()).toEqual([])
    expect(await readFile(path, 'utf-8')).toBe('[]')
  })

  it('resets to initial', async () => {
    const storage = json<number>({ initial: [1, 2], path })

    await storage.append(3, 4, 5)
    await storage.reset()

    expect(await storage.read()).toEqual([1, 2])
  })

  it('returns initial before any append', async () => {
    const storage = json<string>({ initial: ['x', 'y'], path })

    expect(await storage.read()).toEqual(['x', 'y'])
  })

  it('append preserves initial', async () => {
    const storage = json<string>({ initial: ['x', 'y'], path })

    await storage.append('z')

    expect(await storage.read()).toEqual(['x', 'y', 'z'])
  })

  it('does not re-initialize after clear', async () => {
    const storage = json<string>({ initial: ['x', 'y'], path })

    await storage.append('z')
    await storage.clear()
    await storage.append('a')

    expect(await storage.read()).toEqual(['a'])
  })

  it('ignores corrupt content', async () => {
    const storage = json<string>({ path })

    await storage.append('a', 'b')
    await writeFile(path, '{broken json', 'utf-8')

    expect(await storage.read()).toEqual([])
  })
})
