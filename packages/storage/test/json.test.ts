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

  it('does not create file on read alone', async () => {
    const storage = json<string>({ path })

    expect(await storage.read()).toEqual([])

    await expect(readFile(path, 'utf-8')).rejects.toThrow('ENOENT')
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
})
