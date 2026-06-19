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

  it('clears the file to empty', async () => {
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
    expect(await readFile(path, 'utf-8')).toBe('1\n2\n')
  })

  it('returns initial before any append', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    expect(await storage.read()).toEqual(['x', 'y'])
  })

  it('does not create file on read alone', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    await storage.read()

    await expect(readFile(path, 'utf-8')).rejects.toThrow('ENOENT')
  })

  it('append preserves initial', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    await storage.append('z')

    expect(await storage.read()).toEqual(['x', 'y', 'z'])
    expect(await readFile(path, 'utf-8')).toBe('"x"\n"y"\n"z"\n')
  })

  it('does not re-initialize after clear', async () => {
    const storage = jsonl<string>({ initial: ['x', 'y'], path })

    await storage.append('z')
    await storage.clear()
    await storage.append('a')

    expect(await storage.read()).toEqual(['a'])
  })

  it('appends multiple items atomically', async () => {
    const storage = jsonl<string>({ path })

    await storage.append('a')
    await storage.append('b', 'c')

    expect(await storage.read()).toEqual(['a', 'b', 'c'])
    expect(await readFile(path, 'utf-8')).toBe('"a"\n"b"\n"c"\n')
  })

  it('returns the same cached array on subsequent reads', async () => {
    const storage = jsonl<string>({ path })

    await storage.append('a')
    const first = await storage.read()
    const second = await storage.read()

    expect(first).toBe(second)
  })

  it('returns cached content even if the file is changed externally', async () => {
    const storage = jsonl<string>({ path })

    await storage.append('a')
    await storage.read()
    await writeFile(path, '"x"\n', 'utf-8')

    expect(await storage.read()).toEqual(['a'])
  })

  it('serializes concurrent appends', async () => {
    const storage = jsonl<string>({ path })

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

  it('throws on corrupt lines', async () => {
    await writeFile(path, '"a"\n"b"\n{broken line\n', 'utf-8')

    const storage = jsonl<string>({ path })
    await expect(storage.read()).rejects.toThrow('Invalid JSON at line 3')
  })
})
