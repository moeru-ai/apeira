import { describe, expect, it } from 'vitest'

import { kv } from '../src/kv'

const createMemoryStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => { store.delete(key) },
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
}

describe('kv', () => {
  it('append and read', async () => {
    const storage = createMemoryStorage()
    const store = kv<string>({ storage })

    await store.append('a', 'b')
    await store.append('c')

    expect(await store.read()).toEqual(['a', 'b', 'c'])
  })

  it('splits items into segments', async () => {
    const storage = createMemoryStorage()
    const store = kv<number>({ segmentSize: 2, storage })

    await store.append(1, 2, 3, 4, 5)

    expect(await store.read()).toEqual([1, 2, 3, 4, 5])
    expect(storage.getItem('apeira:head')).toBe('3')
    expect(storage.getItem('apeira:seg:0000001')).toBe('[1,2]')
    expect(storage.getItem('apeira:seg:0000002')).toBe('[3,4]')
    expect(storage.getItem('apeira:seg:0000003')).toBe('[5]')
  })

  it('clears all segments and head', async () => {
    const storage = createMemoryStorage()
    const store = kv<number>({ segmentSize: 2, storage })

    await store.append(1, 2, 3)
    await store.clear()

    expect(await store.read()).toEqual([])
    expect(storage.getItem('apeira:head')).toBe('0')
    expect(storage.getItem('apeira:seg:0000001')).toBeNull()
    expect(storage.getItem('apeira:seg:0000002')).toBeNull()
  })

  it('resets to initial', async () => {
    const storage = createMemoryStorage()
    const store = kv<number>({ initial: [1, 2], segmentSize: 2, storage })

    await store.append(3, 4, 5)
    await store.reset()

    expect(await store.read()).toEqual([1, 2])
    expect(storage.getItem('apeira:head')).toBe('1')
    expect(storage.getItem('apeira:seg:0000001')).toBe('[1,2]')
  })

  it('returns initial before any append', async () => {
    const storage = createMemoryStorage()
    const store = kv<string>({ initial: ['x', 'y'], storage })

    expect(await store.read()).toEqual(['x', 'y'])
    expect(storage.getItem('apeira:head')).toBe('1')
    expect(storage.getItem('apeira:seg:0000001')).toBe('["x","y"]')
  })

  it('append preserves initial', async () => {
    const storage = createMemoryStorage()
    const store = kv<string>({ initial: ['x', 'y'], storage })

    await store.append('z')

    expect(await store.read()).toEqual(['x', 'y', 'z'])
    expect(storage.getItem('apeira:seg:0000001')).toBe('["x","y","z"]')
  })
})
