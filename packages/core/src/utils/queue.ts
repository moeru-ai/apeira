import YoctoQueue from 'yocto-queue'

export interface Queue<T> {
  dequeue: () => T | undefined
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

  const dequeue = (): T | undefined =>
    queue.dequeue()

  const drain = (): T[] => {
    const result = Array.from(queue)
    queue.clear()
    return result
  }

  const hasPending = (): boolean => queue.size > 0

  const size = (): number => queue.size

  return {
    dequeue,
    drain,
    enqueue,
    hasPending,
    size,
  }
}
