import type { AgentPlugin, ItemParam, StorageLike } from '@apeira/core'

import type { DmnContext } from './dmn'
import type { ScheduledTask } from './scheduler'
import type { Todo } from './todos'

import { name, version } from '../package.json'
import { createDmnContext, DMN_TICK_INTERVALS, nextDmnState, shouldSkipTick } from './dmn'
import { PROACTIVE_INSTRUCTIONS } from './instructions'
import { Scheduler } from './scheduler'
import { TodoList } from './todos'
import { createBriefTool } from './tools/brief'
import { createControlTools } from './tools/control'
import { createScheduleTools } from './tools/schedule'
import { createTodoTools } from './tools/todo'

export interface ProactivePluginOptions {
  storage?: StorageLike
}

interface ProactiveRuntime {
  agentName: string
  currentTurnHasToolCalls: boolean
  currentTurnId?: string
  dmn: DmnContext
  modelRequestedPause: boolean
  modelRequestedSleep: boolean
  scheduler: Scheduler
  send?: (input: ItemParam) => string
  sessionId: string
  timer?: ReturnType<typeof setTimeout>
  todos: TodoList
}

const getStorageKey = (agentName: string, sessionId: string) =>
  JSON.stringify([agentName, sessionId, 'proactive'])

const renderContextBlocks = (state: ProactiveRuntime, todoTag = 'todos') => {
  const activeTodos = state.todos.getActive()
  const dueTasks = state.scheduler.due()
  const lines: string[] = []

  if (activeTodos.length > 0) {
    lines.push(`  <${todoTag}>`)
    activeTodos.forEach(t => lines.push(`    - [${t.status}] ${t.title}`))
    lines.push(`  </${todoTag}>`)
  }

  if (dueTasks.length > 0) {
    lines.push('  <due_tasks>')
    dueTasks.forEach(t => lines.push(`    - ${t.description}`))
    lines.push('  </due_tasks>')
  }

  return { hasContent: activeTodos.length > 0 || dueTasks.length > 0, lines }
}

const buildTickContent = (state: ProactiveRuntime): string => {
  const now = new Date().toISOString()
  const allTasks = state.scheduler.list()
  const { lines } = renderContextBlocks(state)

  return [
    `<tick time="${now}" state="${state.dmn.state}">`,
    ...lines,
    ...(allTasks.length > 0
      ? [
          '  <scheduled_tasks>',
          ...allTasks.map((task) => {
            if (task.type === 'once' && task.at != null)
              return `    - ${task.id}: [once] at ${new Date(task.at).toISOString()} — ${task.description}`
            if (task.type === 'interval' && task.interval != null)
              return `    - ${task.id}: [interval] every ${task.interval}ms — ${task.description}`
            return ''
          }),
          '  </scheduled_tasks>',
        ]
      : []),
    '</tick>',
  ].filter(Boolean).join('\n')
}

const MIN_INTERVAL_MS = 60_000

const getNextTickInterval = (state: ProactiveRuntime): null | number => {
  const dmnInterval = DMN_TICK_INTERVALS[state.dmn.state]
  if (dmnInterval == null)
    return null

  const now = Date.now()
  const intervals = state.scheduler.list()
    .filter((t): t is ScheduledTask & { createdAt: number, interval: number } =>
      t.type === 'interval' && typeof t.interval === 'number' && typeof t.createdAt === 'number' && t.interval >= MIN_INTERVAL_MS,
    )
    .map((t) => {
      const last = t.lastTriggeredAt ?? t.createdAt
      return Math.max(0, last + t.interval - now)
    })

  if (intervals.length === 0)
    return dmnInterval
  return Math.min(dmnInterval, ...intervals)
}

export const proactive = (options: ProactivePluginOptions = {}): AgentPlugin => {
  const sessions = new Map<string, ProactiveRuntime>()

  const getState = (sessionId: string): ProactiveRuntime | undefined =>
    sessions.get(sessionId)

  const saveState = async (state: ProactiveRuntime) => {
    if (options.storage == null)
      return

    const key = getStorageKey(state.agentName, state.sessionId)
    await options.storage.setItem(key, JSON.stringify({
      dmn: state.dmn,
      tasks: state.scheduler.list(),
      todos: state.todos.list(),
    }))
  }

  const scheduleTick = (state: ProactiveRuntime) => {
    if (state.timer != null)
      clearTimeout(state.timer)

    const interval = getNextTickInterval(state)
    if (interval == null)
      return

    state.timer = setTimeout(() => {
      state.scheduler.prune()

      if (state.dmn.state === 'paused')
        return scheduleTick(state)

      if (shouldSkipTick(state.dmn))
        return scheduleTick(state)

      state.dmn.lastTickAt = Date.now()

      const content = buildTickContent(state)

      // Acknowledge interval tasks so they don't repeat on every tick
      for (const task of state.scheduler.due()) {
        if (task.type === 'interval')
          task.lastTriggeredAt = Date.now()
      }

      try {
        state.send?.({ content, role: 'user', type: 'message' })
      }
      catch {
        if (state.timer != null)
          clearTimeout(state.timer)
        return
      }

      scheduleTick(state)
    }, interval)
  }

  return {
    enforce: 'pre',
    extendInput: ({ sessionId }) => {
      const state = getState(sessionId)
      if (state == null)
        return undefined

      const { hasContent, lines } = renderContextBlocks(state, 'active_todos')
      if (!hasContent)
        return undefined

      return [{
        content: ['<proactive_context>', ...lines, '</proactive_context>'].join('\n'),
        role: 'user',
        type: 'message',
      }] satisfies ItemParam[]
    },
    extendInstructions: () => PROACTIVE_INSTRUCTIONS,
    name,
    onEvent: (event) => {
      const state = getState(event.sessionId)
      if (state == null)
        return

      if (event.type === 'tool-call.start') {
        if (state.currentTurnId === event.turnId)
          state.currentTurnHasToolCalls = true
      }

      if (event.type === 'turn.input_queued' || event.type === 'turn.start') {
        state.dmn.lastUserInputAt = Date.now()
      }
    },
    onSessionInit: async (initOptions) => {
      const { agentName, send, sessionId } = initOptions

      let dmn = createDmnContext()
      let scheduler = new Scheduler()
      let todos = new TodoList()

      if (options.storage != null) {
        try {
          const raw = await options.storage.getItem(getStorageKey(agentName, sessionId))
          if (raw != null && raw.length > 0) {
            const parsed = JSON.parse(raw) as { dmn: DmnContext, tasks: ScheduledTask[], todos: Todo[] }
            dmn = parsed.dmn
            scheduler = Scheduler.fromArray(parsed.tasks)
            todos = TodoList.fromArray(parsed.todos)
          }
        }
        catch {
          // ignore load errors
        }
      }

      const state: ProactiveRuntime = {
        agentName,
        currentTurnHasToolCalls: false,
        dmn,
        modelRequestedPause: false,
        modelRequestedSleep: false,
        scheduler,
        send,
        sessionId,
        todos,
      }

      sessions.set(sessionId, state)
      scheduleTick(state)
    },
    onTurnDone: async (turnOptions) => {
      const state = getState(turnOptions.sessionId)
      if (state == null)
        return

      const hasToolCalls = state.currentTurnHasToolCalls
      const modelSlept = state.modelRequestedSleep

      state.dmn.state = nextDmnState(state.dmn, hasToolCalls, modelSlept)
      state.currentTurnHasToolCalls = false
      state.modelRequestedSleep = false

      if (state.modelRequestedPause) {
        state.dmn.state = 'paused'
        state.modelRequestedPause = false
      }

      scheduleTick(state)
      await saveState(state)
    },
    onTurnStart: (turnOptions) => {
      const state = getState(turnOptions.sessionId)
      if (state == null)
        return

      state.currentTurnId = turnOptions.turnId
      state.currentTurnHasToolCalls = false
    },
    resolveTools: async ({ sessionId }) => {
      const state = getState(sessionId)
      if (state == null)
        return undefined

      const controls = createControlTools({
        onPause: () => {
          state.modelRequestedPause = true
        },
        onResume: () => {
          state.dmn.state = 'foraging'
          scheduleTick(state)
        },
        onSleep: () => {
          state.modelRequestedSleep = true
        },
      })

      const schedule = createScheduleTools(state.scheduler)
      const todo = createTodoTools(state.todos)
      const brief = createBriefTool(state.send)

      const all = [...controls, ...schedule, ...todo, brief]
      return Promise.all(all)
    },
    storage: options.storage,
    version,
  }
}
