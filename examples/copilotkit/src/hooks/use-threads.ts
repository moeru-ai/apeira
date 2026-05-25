/* eslint-disable @masknet/browser-no-persistent-storage */
import type { ItemParam } from '@apeira/core'

import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useMemo } from 'react'

import { AGENT_NAME } from '../utils/const'

const THREADS_KEY = 'apeira:copilotkit:threads'
const ACTIVE_THREAD_KEY = 'apeira:copilotkit:active-thread-id'

export interface LocalThread {
  archived?: boolean
  createdAt: number
  id: string
  name?: string
  updatedAt: number
}

interface PersistedThreadState {
  episodic?: string
}

const now = () => Date.now()
const byUpdatedAt = (left: LocalThread, right: LocalThread) =>
  right.updatedAt - left.updatedAt

const getThreadStorageKey = (threadId: string) =>
  JSON.stringify([AGENT_NAME, threadId])

const readThreadState = (threadId: string) => {
  try {
    return JSON.parse(localStorage.getItem(getThreadStorageKey(threadId)) ?? '{}') as PersistedThreadState
  }
  catch {
    return {}
  }
}

const isItemEpisode = (episode: { type: string, payload?: { item?: ItemParam } }): episode is { type: 'item', payload: { item: ItemParam } } =>
  episode.type === 'item' && episode.payload?.item != null

const readThreadItems = (threadId: string): ItemParam[] => {
  try {
    return (readThreadState(threadId).episodic ?? '')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type: string, payload?: { item?: ItemParam } })
      .filter(isItemEpisode)
      .map(episode => episode.payload.item)
  }
  catch {
    return []
  }
}

const getText = (content: Extract<ItemParam, { type: 'message' }>['content']) =>
  typeof content === 'string'
    ? content
    : content.flatMap(part => 'text' in part ? [part.text] : []).join(' ')

const getThreadName = (threadId: string) => {
  const message = readThreadItems(threadId).find((item): item is Extract<ItemParam, { role: 'user', type: 'message' }> =>
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
    if (readThreadItems(threadId).length === 0)
      return

    setThreads((current) => {
      const threads = current ?? []
      const existing = threads.find(thread => thread.id === threadId)
      const updatedAt = now()
      const thread: LocalThread = {
        archived: existing?.archived,
        createdAt: existing?.createdAt ?? updatedAt,
        id: threadId,
        name: existing?.name ?? getThreadName(threadId),
        updatedAt,
      }

      return [
        thread,
        ...threads.filter(thread => thread.id !== threadId),
      ].sort(byUpdatedAt)
    })
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
