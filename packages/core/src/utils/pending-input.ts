import type { QueuedInput } from './turn-runner'

import { createQueue } from './queue'

export interface PendingInput {
  clear: () => void
  delete: (turnId: string) => boolean
  drain: (turnId: string) => QueuedInput[]
  enqueue: (turnId: string, input: QueuedInput) => void
}

export const createPendingInput = (): PendingInput => {
  const entries = new Map<string, ReturnType<typeof createQueue<QueuedInput>>>()

  const queueFor = (turnId: string) => {
    const existing = entries.get(turnId)
    if (existing != null)
      return existing

    const queue = createQueue<QueuedInput>()
    entries.set(turnId, queue)
    return queue
  }

  return {
    clear: () => entries.clear(),
    delete: (turnId: string) => entries.delete(turnId),
    drain: (turnId: string) => {
      const queue = entries.get(turnId)
      entries.delete(turnId)
      return queue == null
        ? []
        : Array.from(queue.drain()).filter(item => item.signal?.aborted !== true)
    },
    enqueue: (turnId: string, input: QueuedInput) =>
      queueFor(turnId).enqueue(input),
  }
}
