import { describe, expect, it } from 'vitest'

import { kv } from '../src/kv'

const createMemoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => { map.delete(key) },
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

describe('kv', () => {
  it('append and read', async () => {
    const backend = createMemoryStorage()
    const storage = kv<string>({ storage: backend })

    await storage.append('a', 'b')
    await storage.append('c')

    expect(await storage.read()).toEqual(['a', 'b', 'c'])
  })

  it('serializes concurrent appends with the same storage and prefix', async () => {
    const backend = createMemoryStorage()
    const first = kv<string>({ storage: backend })
    const second = kv<string>({ storage: backend })

    await Promise.all([
      first.append('a'),
      second.append('b'),
    ])

    expect(await first.read()).toEqual(['a', 'b'])
  })

  it('splits items into segments', async () => {
    const backend = createMemoryStorage()
    const storage = kv<number>({ segmentSize: 2, storage: backend })

    await storage.append(1, 2, 3, 4, 5)

    expect(await storage.read()).toEqual([1, 2, 3, 4, 5])
    expect(backend.getItem('apeira:head')).toBe('3')
    expect(backend.getItem('apeira:seg:0000001')).toBe('[1,2]')
    expect(backend.getItem('apeira:seg:0000002')).toBe('[3,4]')
    expect(backend.getItem('apeira:seg:0000003')).toBe('[5]')
  })

  it('clears all segments and head', async () => {
    const backend = createMemoryStorage()
    const storage = kv<number>({ segmentSize: 2, storage: backend })

    await storage.append(1, 2, 3)
    await storage.clear()

    expect(await storage.read()).toEqual([])
    expect(backend.getItem('apeira:head')).toBe('0')
    expect(backend.getItem('apeira:seg:0000001')).toBeNull()
    expect(backend.getItem('apeira:seg:0000002')).toBeNull()
  })

  it('resets to initial', async () => {
    const backend = createMemoryStorage()
    const storage = kv<number>({ initial: [1, 2], segmentSize: 2, storage: backend })

    await storage.append(3, 4, 5)
    await storage.reset()

    expect(await storage.read()).toEqual([1, 2])
    expect(backend.getItem('apeira:head')).toBe('1')
    expect(backend.getItem('apeira:seg:0000001')).toBe('[1,2]')
  })

  it('returns initial before any append', async () => {
    const backend = createMemoryStorage()
    const storage = kv<string>({ initial: ['x', 'y'], storage: backend })

    expect(await storage.read()).toEqual(['x', 'y'])
    expect(backend.getItem('apeira:head')).toBe('1')
    expect(backend.getItem('apeira:seg:0000001')).toBe('["x","y"]')
  })

  it('append preserves initial', async () => {
    const backend = createMemoryStorage()
    const storage = kv<string>({ initial: ['x', 'y'], storage: backend })

    await storage.append('z')

    expect(await storage.read()).toEqual(['x', 'y', 'z'])
    expect(backend.getItem('apeira:seg:0000001')).toBe('["x","y","z"]')
  })
})
