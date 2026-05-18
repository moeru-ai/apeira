/* eslint-disable @masknet/browser-no-persistent-storage */
import type { Agent, ItemParam } from '@apeira/core'
import type { AGUIEvent, BaseEvent, Message, RunAgentInput } from '@copilotkit/react-core/v2'
import type { Subscriber } from 'rxjs'

import { AG_UI_CHANNEL } from '@apeira/plugin-ag-ui'
import {
  AbstractAgent,
  EventType,
} from '@copilotkit/react-core/v2'
import { Observable } from 'rxjs'

import { AGENT_ID, AGENT_NAME } from './const'

interface BrowserApeiraAgentOptions {
  agent: Agent<any>
}

type PersistedMessageItem = Extract<ItemParam, { type: 'message' }>

interface PersistedThreadState {
  items?: ItemParam[]
}
type UserContentPart = Exclude<Extract<Message, { role: 'user' }>['content'], string>[number]

const getStorageKey = (threadId: string) =>
  JSON.stringify([AGENT_NAME, threadId])

const toDataUrl = (mimeType: string, value: string) =>
  `data:${mimeType};base64,${value}`

const toUserInput = (messages: RunAgentInput['messages']): ItemParam | undefined => {
  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user')

  if (lastUserMessage == null)
    return undefined

  if (typeof lastUserMessage.content === 'string') {
    return {
      content: lastUserMessage.content,
      role: 'user',
      type: 'message',
    }
  }

  const content: NonNullable<Extract<PersistedMessageItem, { role: 'user' }>['content']> = []

  for (const part of lastUserMessage.content as UserContentPart[]) {
    // TODO: more part type
    // eslint-disable-next-line ts/switch-exhaustiveness-check
    switch (part.type) {
      case 'image':
        content.push({
          image_url: part.source.type === 'url'
            ? part.source.value
            : toDataUrl(part.source.mimeType, part.source.value),
          type: 'input_image',
        })
        break

      case 'text':
        content.push({
          text: part.text,
          type: 'input_text',
        })
        break
    }
  }

  if (content.length === 0)
    return undefined

  return {
    content,
    role: 'user',
    type: 'message',
  }
}

const toMessageText = (value: PersistedMessageItem['content']) => {
  if (typeof value === 'string')
    return value

  return value
    .flatMap((part) => {
      if ('text' in part)
        return [part.text]

      if ('refusal' in part)
        return [part.refusal]

      return []
    })
    .join('\n')
}

const readPersistedMessages = (threadId: string): Message[] => {
  try {
    const raw = localStorage.getItem(getStorageKey(threadId))
    if (raw == null)
      return []

    const state = JSON.parse(raw) as PersistedThreadState
    const items = state.items ?? []

    return items.flatMap((item): Message[] => {
      // TODO
      // eslint-disable-next-line ts/switch-exhaustiveness-check
      switch (item.type) {
        case 'function_call_output':
          return [{
            content: typeof item.output === 'string'
              ? item.output
              : JSON.stringify(item.output),
            id: item.id ?? item.call_id,
            role: 'tool',
            toolCallId: item.call_id,
          }]

        case 'message': {
          const content = toMessageText(item.content)
          if (content.length === 0)
            return []

          if (item.role === 'assistant') {
            return [{
              content,
              id: item.id ?? crypto.randomUUID(),
              role: 'assistant',
            }]
          }

          if (item.role === 'developer' || item.role === 'system') {
            return [{
              content,
              id: item.id ?? crypto.randomUUID(),
              role: item.role,
            }]
          }

          if (item.role === 'user') {
            return [{
              content,
              id: item.id ?? crypto.randomUUID(),
              role: 'user',
            }]
          }

          return []
        }

        default:
          return []
      }
    })
  }
  catch {
    return []
  }
}

export class BrowserApeiraAgent extends AbstractAgent {
  private readonly options: BrowserApeiraAgentOptions

  constructor(options: BrowserApeiraAgentOptions) {
    super({
      agentId: AGENT_ID,
      description: 'Apeira browser agent',
      initialMessages: readPersistedMessages('default'),
      threadId: 'default',
    })
    this.options = options
  }

  override clone(): this {
    const cloned = new BrowserApeiraAgent(this.options) as this
    cloned.agentId = this.agentId
    cloned.threadId = this.threadId
    cloned.setMessages(readPersistedMessages(this.threadId))
    return cloned
  }

  override run(input: RunAgentInput) {
    return new Observable<BaseEvent>((subscriber: Subscriber<BaseEvent>) => {
      const userInput = toUserInput(input.messages)

      if (userInput == null) {
        subscriber.next({
          code: 'invalid_input',
          message: 'Only text and image user messages are supported in this example.',
          timestamp: Date.now(),
          type: EventType.RUN_ERROR,
        })
        subscriber.complete()
        return
      }

      const thread = this.options.agent.thread({ id: this.threadId })
      let activeRunId: string | undefined

      const unsubscribe = thread.subscribe(AG_UI_CHANNEL, (event: unknown) => {
        const aguiEvent = event as AGUIEvent & {
          rawEvent?: { threadId?: string, turnId?: string }
          runId?: string
          threadId?: string
        }

        const eventThreadId = aguiEvent.threadId ?? (aguiEvent.rawEvent as undefined | { threadId?: string })?.threadId
        if (eventThreadId != null && eventThreadId !== this.threadId)
          return

        const eventRunId = aguiEvent.runId ?? (aguiEvent.rawEvent as undefined | { turnId?: string })?.turnId

        if (activeRunId == null && eventRunId != null)
          activeRunId = eventRunId

        if (activeRunId != null && eventRunId != null && eventRunId !== activeRunId)
          return

        if (aguiEvent.type === EventType.RUN_STARTED)
          this.isRunning = true

        if (aguiEvent.type === EventType.RUN_FINISHED || aguiEvent.type === EventType.RUN_ERROR)
          this.isRunning = false

        subscriber.next(event as BaseEvent)

        if (aguiEvent.type === EventType.RUN_FINISHED || aguiEvent.type === EventType.RUN_ERROR)
          subscriber.complete()
      })

      const reader = thread.run(userInput).getReader()

      void (async () => {
        try {
          while (true) {
            const { done } = await reader.read()
            if (done)
              break
          }
        }
        catch (error) {
          if (!subscriber.closed) {
            subscriber.error(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })()

      return () => {
        unsubscribe()
        void reader.cancel().catch(() => undefined)

        if (this.isRunning)
          thread.abort('cancelled')
      }
    })
  }

  protected override connect(_input: RunAgentInput) {
    return new Observable<BaseEvent>((subscriber: Subscriber<BaseEvent>) => {
      subscriber.next({
        timestamp: Date.now(),
        type: EventType.RUN_STARTED,
      })

      const messages = readPersistedMessages(this.threadId)

      if (messages.length > 0) {
        subscriber.next({
          messages,
          timestamp: Date.now(),
          type: EventType.MESSAGES_SNAPSHOT,
        })
      }

      subscriber.next({
        timestamp: Date.now(),
        type: EventType.RUN_FINISHED,
      })

      subscriber.complete()
    })
  }
}
