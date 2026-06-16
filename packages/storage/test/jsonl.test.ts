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
    const store = jsonl<string>({ path })

    await store.append('a', 'b')
    await store.append('c')

    expect(await store.read()).toEqual(['a', 'b', 'c'])
  })

  it('writes newline-delimited json', async () => {
    const store = jsonl<number>({ path })

    await store.append(1, 2, 3)

    const raw = await readFile(path, 'utf-8')
    expect(raw).toBe('1\n2\n3\n')
  })

  it('clears the file', async () => {
    const store = jsonl<string>({ path })

    await store.append('a')
    await store.clear()

    expect(await store.read()).toEqual([])
    expect(await readFile(path, 'utf-8')).toBe('')
  })

  it('resets to initial', async () => {
    const store = jsonl<number>({ initial: [1, 2], path })

    await store.append(3, 4, 5)
    await store.reset()

    expect(await store.read()).toEqual([1, 2])
  })

  it('returns initial before any append', async () => {
    const store = jsonl<string>({ initial: ['x', 'y'], path })

    expect(await store.read()).toEqual(['x', 'y'])
  })

  it('append preserves initial', async () => {
    const store = jsonl<string>({ initial: ['x', 'y'], path })

    await store.append('z')

    expect(await store.read()).toEqual(['x', 'y', 'z'])
  })

  it('does not re-initialize after clear', async () => {
    const store = jsonl<string>({ initial: ['x', 'y'], path })

    await store.append('z')
    await store.clear()
    await store.append('a')

    expect(await store.read()).toEqual(['a'])
  })

  it('ignores corrupt lines', async () => {
    const store = jsonl<string>({ path })

    await store.append('a', 'b')
    await store.append('c')

    const raw = await readFile(path, 'utf-8')
    await writeFile(path, `${raw}{broken line\n`, 'utf-8')

    expect(await store.read()).toEqual(['a', 'b', 'c'])
  })
})
