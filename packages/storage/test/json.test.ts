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
    const store = json<string>({ path })

    await store.append('a', 'b')
    await store.append('c')

    expect(await store.read()).toEqual(['a', 'b', 'c'])
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
    const store = json<number>({ path })

    await store.append(1, 2, 3)

    const raw = await readFile(path, 'utf-8')
    expect(raw).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('clears the file', async () => {
    const store = json<string>({ path })

    await store.append('a')
    await store.clear()

    expect(await store.read()).toEqual([])
    expect(await readFile(path, 'utf-8')).toBe('[]')
  })

  it('resets to initial', async () => {
    const store = json<number>({ initial: [1, 2], path })

    await store.append(3, 4, 5)
    await store.reset()

    expect(await store.read()).toEqual([1, 2])
  })

  it('returns initial before any append', async () => {
    const store = json<string>({ initial: ['x', 'y'], path })

    expect(await store.read()).toEqual(['x', 'y'])
  })

  it('append preserves initial', async () => {
    const store = json<string>({ initial: ['x', 'y'], path })

    await store.append('z')

    expect(await store.read()).toEqual(['x', 'y', 'z'])
  })

  it('ignores corrupt content', async () => {
    const store = json<string>({ path })

    await store.append('a', 'b')
    await writeFile(path, '{broken json', 'utf-8')

    expect(await store.read()).toEqual([])
  })
})
