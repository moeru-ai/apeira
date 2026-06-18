/* eslint-disable @masknet/browser-no-persistent-storage */
import type { AgentEntry, AgentInput } from '@apeira/core'

import { toAgentInput } from '@apeira/core'
import { kv } from '@apeira/storage/kv'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useMemo } from 'react'

import { getThreadStorePrefix } from '../utils/storage'

const THREADS_KEY = 'apeira:copilotkit:threads'
const ACTIVE_THREAD_KEY = 'apeira:copilotkit:active-thread-id'

export interface LocalThread {
  archived?: boolean
  createdAt: number
  id: string
  name?: string
  updatedAt: number
}

const now = () => Date.now()
const byUpdatedAt = (left: LocalThread, right: LocalThread) =>
  right.updatedAt - left.updatedAt

const getText = (content: Extract<AgentInput, { type: 'message' }>['content']) =>
  typeof content === 'string'
    ? content
    : content.flatMap(part => 'text' in part ? [part.text] : []).join(' ')

const getThreadNameFromItems = (items: readonly AgentInput[]) => {
  const message = items.find((item): item is Extract<AgentInput, { role: 'user', type: 'message' }> =>
    item.type === 'message' && item.role === 'user',
  )
  const text = message == null ? '' : getText(message.content).trim()
  return text.length > 48 ? `${text.slice(0, 48)}...` : text || undefined
}

const createThreadId = () => crypto.randomUUID()

export const useThreads = () => {
  const [storedThreads, setThreads] = useLocalStorage<LocalThread[]>(THREADS_KEY, [])
  const [activeThreadId, setActiveThreadId] = useLocalStorage<string>(ACTIVE_THREAD_KEY)
  const threads = useMemo(() => storedThreads ?? [], [storedThreads])
  const visibleThreads = useMemo(() => threads.filter(thread => !thread.archived), [threads])
  const activeThread = useMemo(
    () => threads.find(thread => thread.id === activeThreadId),
    [activeThreadId, threads],
  )

  useEffect(() => {
    if (activeThreadId != null && activeThread?.archived !== true)
      return

    setActiveThreadId(visibleThreads[0]?.id ?? createThreadId())
  }, [activeThread, activeThreadId, setActiveThreadId, visibleThreads])

  const updateThread = useCallback((threadId: string, update: (thread: LocalThread) => LocalThread) => {
    setThreads(current => (current ?? [])
      .map(thread => thread.id === threadId ? update(thread) : thread)
      .sort(byUpdatedAt))
  }, [setThreads])

  const createThread = useCallback(() => {
    setActiveThreadId(createThreadId())
  }, [setActiveThreadId])

  const renameThread = useCallback((threadId: string, name: string) => {
    updateThread(threadId, thread => ({
      ...thread,
      name: name.trim() || undefined,
      updatedAt: now(),
    }))
  }, [updateThread])

  const archiveThread = useCallback((threadId: string) => {
    updateThread(threadId, thread => ({
      ...thread,
      archived: true,
      updatedAt: now(),
    }))
  }, [updateThread])

  const touchThread = useCallback((threadId: string) => {
    const update = async () => {
      const storage = kv<AgentEntry>({
        prefix: getThreadStorePrefix(threadId),
        storage: localStorage,
      })
      const items = await storage.read()

      if (items.length === 0)
        return

      const name = getThreadNameFromItems(toAgentInput(items))

      setThreads((current) => {
        const threads = current ?? []
        const existing = threads.find(thread => thread.id === threadId)
        const updatedAt = now()
        const thread: LocalThread = {
          archived: existing?.archived,
          createdAt: existing?.createdAt ?? updatedAt,
          id: threadId,
          name: existing?.name ?? name,
          updatedAt,
        }

        return [
          thread,
          ...threads.filter(thread => thread.id !== threadId),
        ].sort(byUpdatedAt)
      })
    }

    void update()
  }, [setThreads])

  return {
    activeThreadId: activeThreadId ?? visibleThreads[0]?.id,
    archiveThread,
    createThread,
    renameThread,
    selectThread: setActiveThreadId,
    threads: visibleThreads,
    touchThread,
  }
}
