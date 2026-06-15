import type { AgentInput, AgentStore, MaybePromise } from '@apeira/core'

export interface KVStoreOptions<T> {
  initial?: readonly T[]
  /** @default `apeira` */
  prefix?: string
  /** @default `100` */
  segmentSize?: number
  storage: StorageLike
}

export interface StorageLike {
  getItem: (key: string) => MaybePromise<null | string | undefined>
  removeItem: (key: string) => MaybePromise<void>
  setItem: (key: string, value: string) => MaybePromise<void>
}

const headKeyOf = (prefix: string) => `${prefix}:head`
const segmentKeyOf = (prefix: string, seg: number) =>
  `${prefix}:seg:${String(seg).padStart(7, '0')}`

const encode = <T>(items: readonly T[]) => JSON.stringify(items)

const decode = <T>(raw: string): T[] => {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value as T[] : []
  }
  catch {
    return []
  }
}

export const kv = <T = AgentInput>(options: KVStoreOptions<T>): AgentStore<T> => {
  const segmentSize = options.segmentSize ?? 100
  if (!Number.isInteger(segmentSize) || segmentSize <= 0)
    throw new Error('segmentSize must be a positive integer')

  const prefix = options.prefix ?? 'apeira'
  const headKey = headKeyOf(prefix)
  const segmentKey = (seg: number) => segmentKeyOf(prefix, seg)

  const getHead = async (): Promise<null | number> => {
    const raw = await options.storage.getItem(headKey)

    if (raw == null)
      return null

    const num = Number.parseInt(raw, 10)
    return Number.isNaN(num) || num < 0 ? 0 : num
  }

  const setHead = async (seg: number) => {
    await options.storage.setItem(headKey, String(seg))
  }

  const readSegment = async (seg: number): Promise<T[]> => {
    const raw = await options.storage.getItem(segmentKey(seg))

    if (raw == null)
      return []

    return decode<T>(raw)
  }

  const writeSegment = async (seg: number, items: readonly T[]) => {
    await options.storage.setItem(segmentKey(seg), encode(items))
  }

  const removeSegment = async (seg: number) => {
    await options.storage.removeItem(segmentKey(seg))
  }

  const clearSegments = async () => {
    const head = await getHead()

    if (head != null && head > 0) {
      await Promise.all(
        Array.from({ length: head }, async (_, i) => removeSegment(i + 1)),
      )
    }

    await setHead(0)
  }

  const writeItems = async (items: readonly T[]) => {
    if (items.length === 0) {
      await setHead(0)
      return
    }

    let head = 1

    for (let offset = 0; offset < items.length; offset += segmentSize) {
      await writeSegment(head, items.slice(offset, offset + segmentSize))
      head++
    }

    await setHead(head - 1)
  }

  const ensureInitialized = async () => {
    const head = await getHead()

    if (head != null)
      return

    await writeItems(options.initial ?? [])
  }

  return {
    append: async (...items) => {
      if (items.length === 0)
        return

      await ensureInitialized()

      let head = await getHead()

      if (head == null || head === 0)
        head = 1

      let current = await readSegment(head)
      let offset = 0

      while (offset < items.length) {
        if (current.length >= segmentSize) {
          await writeSegment(head, current)
          head++
          current = []
          continue
        }

        const space = segmentSize - current.length
        const take = Math.min(space, items.length - offset)

        current.push(...items.slice(offset, offset + take))
        offset += take
      }

      await writeSegment(head, current)
      await setHead(head)
    },

    clear: clearSegments,

    read: async () => {
      await ensureInitialized()

      const head = await getHead()

      if (head == null || head === 0)
        return Object.freeze([])

      const segments = await Promise.all(
        Array.from({ length: head }, async (_, i) => readSegment(i + 1)),
      )

      return Object.freeze(segments.flat())
    },

    reset: async () => {
      await clearSegments()
      await writeItems(options.initial ?? [])
    },
  }
}
