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

  it('writes pretty-printed json array', async () => {
    const storage = json<number>({ path })

    await storage.append(1, 2, 3)

    const raw = await readFile(path, 'utf-8')
    expect(raw).toBe('[\n  1,\n  2,\n  3\n]\n')
  })

  it('clears the file to empty', async () => {
    const storage = json<string>({ path })

    await storage.append('a')
    await storage.clear()

    expect(await storage.read()).toEqual([])
    expect(await readFile(path, 'utf-8')).toBe('')
  })

  it('resets to initial', async () => {
    const storage = json<number>({ initial: [1, 2], path })

    await storage.append(3, 4, 5)
    await storage.reset()

    expect(await storage.read()).toEqual([1, 2])
    expect(await readFile(path, 'utf-8')).toBe('[\n  1,\n  2\n]\n')
  })

  it('returns initial before any append', async () => {
    const storage = json<string>({ initial: ['x', 'y'], path })

    expect(await storage.read()).toEqual(['x', 'y'])
  })

  it('does not create file on read alone', async () => {
    const storage = json<string>({ initial: ['x', 'y'], path })

    await storage.read()

    await expect(readFile(path, 'utf-8')).rejects.toThrow('ENOENT')
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

  it('throws on invalid json', async () => {
    await writeFile(path, '{broken', 'utf-8')

    const storage = json<string>({ path })
    await expect(storage.read()).rejects.toThrow('Invalid JSON')
  })

  it('throws on non-array content', async () => {
    await writeFile(path, '{"not":"array"}\n', 'utf-8')

    const storage = json<string>({ path })
    await expect(storage.read()).rejects.toThrow('Invalid storage file')
  })

  it('returns the same cached array on subsequent reads', async () => {
    const storage = json<string>({ path })

    await storage.append('a')
    const first = await storage.read()
    const second = await storage.read()

    expect(first).toBe(second)
  })

  it('returns cached content even if the file is changed externally', async () => {
    const storage = json<string>({ path })

    await storage.append('a')
    await storage.read()
    await writeFile(path, '["x"]\n', 'utf-8')

    expect(await storage.read()).toEqual(['a'])
  })

  it('serializes concurrent appends', async () => {
    const storage = json<string>({ path })

    await Promise.all([
      storage.append('a'),
      storage.append('b'),
      storage.append('c'),
    ])

    const entries = await storage.read()
    expect(entries).toHaveLength(3)
    expect(entries).toContain('a')
    expect(entries).toContain('b')
    expect(entries).toContain('c')
  })

  it('serializes concurrent appends from different instances sharing the same path', async () => {
    const first = json<number>({ path })
    const second = json<number>({ path })

    await Promise.all(
      Array.from({ length: 20 }, async (_, index) =>
        (index % 2 === 0 ? first : second).append(index)),
    )

    expect([...(await first.read())].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index))
  })
})
