import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext, Instructions } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentPlugin, AgentPluginApi } from '../types/plugin'
import type { SessionOptions } from './agent'
import type { AgentSession, SessionForkOptions, SessionForkSource } from './agent-session'
import type { SessionPersistence } from './session-persistence'

import { merge } from '@moeru/std/merge'

import { createAgentSession } from './agent-session'

export interface SessionManager<T> {
  session: (options?: SessionOptions<T>) => AgentSession<T>
}

export interface SessionManagerOptions<T> {
  agentContext: () => AgentContext<T>
  agentName: string
  defaultSessionId: string
  emitChannel: AgentPluginApi['emit']
  emitTurn: (sessionId: string, turnId: string, event: Omit<AgentEvent, 'sessionId' | 'turnId'>) => void
  instructions: Instructions<T>
  persistence: SessionPersistence<T>
  pluginApi: AgentPluginApi
  plugins: AgentPlugin<T>[]
  ready: Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

export const createSessionManager = <T>(options: SessionManagerOptions<T>): SessionManager<T> => {
  const sessions = new Map<string, AgentSession<T>>()

  const sessionConfig = {
    agentContext: options.agentContext,
    agentName: options.agentName,
    defaultSessionId: options.defaultSessionId,
    emitChannel: options.emitChannel,
    emitTurn: options.emitTurn,
    instructions: options.instructions,
    onRemove: (sessionId: string) => sessions.delete(sessionId),
    persistence: options.persistence,
    pluginApi: options.pluginApi,
    plugins: options.plugins,
    ready: options.ready,
    responseOptions: options.responseOptions,
  }

  const forkSession = async (
    source: SessionForkSource<T>,
    forkOptions: SessionForkOptions<T> = {},
  ): Promise<AgentSession<T>> => {
    const forkId = forkOptions.id ?? crypto.randomUUID()

    if (sessions.has(forkId))
      throw new Error(`Session already exists: ${forkId}`)

    const snapshot = await source.snapshot()
    const forkContext = merge(snapshot.context, forkOptions.context ?? {})

    if (sessions.has(forkId))
      throw new Error(`Session already exists: ${forkId}`)

    const forked = createAgentSession({
      ...sessionConfig,
      forkSession,
      id: forkId,
      initial: {
        context: forkContext,
        episodic: snapshot.episodic,
      },
    })

    sessions.set(forkId, forked)

    try {
      await options.persistence.save(forkId, {
        context: forkContext,
        episodic: snapshot.episodic,
      })
    }
    catch (error) {
      sessions.delete(forkId)
      throw error
    }

    return forked
  }

  const createSession = (
    id: string,
    sessionOptions: SessionOptions<T> = {},
  ): AgentSession<T> =>
    createAgentSession({
      ...sessionConfig,
      forkSession,
      id,
      initial: {
        context: sessionOptions.context,
        episodic: sessionOptions.episodic,
        input: sessionOptions.input,
      },
    })

  const session: SessionManager<T>['session'] = (sessionOptions = {}) => {
    const id = sessionOptions.id ?? crypto.randomUUID()
    const existing = sessions.get(id)
    if (existing != null) {
      if (sessionOptions.input != null)
        throw new Error(`Session already exists: ${id}`)

      if (sessionOptions.context != null)
        existing.setContext(sessionOptions.context)

      return existing
    }

    const agentSession = createSession(id, sessionOptions)

    sessions.set(id, agentSession)

    return agentSession
  }

  return { session }
}
