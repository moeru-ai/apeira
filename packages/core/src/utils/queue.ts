import YoctoQueue from 'yocto-queue'

export class Queue<T extends NonNullable<unknown>> extends YoctoQueue<T> {
  #seq = 0

  override enqueue(item: T): number {
    super.enqueue(item)
    this.#seq += 1

    return this.#seq
  }
}

export const createQueue = <T extends NonNullable<unknown>>(): Queue<T> =>
  new Queue<T>()
