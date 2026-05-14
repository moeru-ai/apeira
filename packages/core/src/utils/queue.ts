import YoctoQueue from 'yocto-queue'

export interface Queue<T> {
  clear: () => void
  drain: () => T[]
  enqueue: (item: T) => number
  hasPending: () => boolean
  size: () => number
}

export const createQueue = <T extends NonNullable<unknown>>(): Queue<T> => {
  const queue = new YoctoQueue<T>()
  let seq = 0

  const enqueue = (item: T): number => {
    queue.enqueue(item)
    seq += 1
    return seq
  }

  const clear = (): void =>
    queue.clear()

  const drain = (): T[] => {
    const result = Array.from(queue)
    clear()
    return result
  }

  const hasPending = (): boolean => queue.size > 0

  const size = (): number => queue.size

  return {
    clear,
    drain,
    enqueue,
    hasPending,
    size,
  }
}
