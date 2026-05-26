import type { Lock, QueueEntry, StateAdapter } from 'chat'

export class MemoryStateAdapter implements StateAdapter {
  private data = new Map<string, { expiresAt?: number, value: unknown }>()
  private lists = new Map<string, unknown[]>()
  private locks = new Map<string, Lock>()
  private subscriptions = new Set<string>()

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const existing = this.locks.get(threadId)
    if (existing && existing.expiresAt > Date.now())
      return null
    const lock: Lock = {
      expiresAt: Date.now() + ttlMs,
      threadId,
      token: crypto.randomUUID(),
    }
    this.locks.set(threadId, lock)
    return lock
  }

  async appendToList(key: string, value: unknown, options?: { maxLength?: number, ttlMs?: number }): Promise<void> {
    let list = (this.lists.get(key) ?? [])
    list.push(value)
    if (options?.maxLength != null && list.length > options.maxLength)
      list = list.slice(-options.maxLength)

    this.lists.set(key, list)

    if (options?.ttlMs != null)
      // eslint-disable-next-line @masknet/prefer-timer-id
      setTimeout(() => this.lists.delete(key), options.ttlMs)
  }

  async connect(): Promise<void> {}

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async dequeue(threadId: string): Promise<null | QueueEntry> {
    const key = `queue:${threadId}`
    const list = this.lists.get(key) ?? []
    const entry = (list.shift() ?? null) as null | QueueEntry
    if (list.length === 0)
      this.lists.delete(key)
    else this.lists.set(key, list)
    return entry
  }

  async disconnect(): Promise<void> {}

  async enqueue(threadId: string, entry: QueueEntry, _maxSize: number): Promise<number> {
    const key = `queue:${threadId}`
    const list = this.lists.get(key) ?? []
    list.push(entry)
    this.lists.set(key, list)
    return list.length
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(lock.threadId)

    if (!existing || existing.token !== lock.token)
      return false

    existing.expiresAt = Date.now() + ttlMs

    return true
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.locks.delete(threadId)
  }

  async get<T = unknown>(key: string): Promise<null | T> {
    const entry = this.data.get(key)

    if (!entry || this.isExpired(entry)) {
      if (entry)
        this.data.delete(key)

      return null
    }

    return entry.value as T
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    return (this.lists.get(key) ?? []) as T[]
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this.subscriptions.has(threadId)
  }

  async queueDepth(threadId: string): Promise<number> {
    const key = `queue:${threadId}`
    return this.lists.get(key)?.length ?? 0
  }

  async releaseLock(lock: Lock): Promise<void> {
    const existing = this.locks.get(lock.threadId)
    if (existing && existing.token === lock.token) {
      this.locks.delete(lock.threadId)
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.data.set(key, {
      expiresAt: ttlMs != null ? Date.now() + ttlMs : undefined,
      value,
    })
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    if (await this.get(key) !== null)
      return false

    await this.set(key, value, ttlMs)

    return true
  }

  async subscribe(threadId: string): Promise<void> {
    this.subscriptions.add(threadId)
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.subscriptions.delete(threadId)
  }

  private isExpired(entry: { expiresAt?: number }): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt
  }
}

export const createMemoryState = (): MemoryStateAdapter =>
  new MemoryStateAdapter()
