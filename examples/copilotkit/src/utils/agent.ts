/* eslint-disable @masknet/browser-no-persistent-storage */
import type { Agent, CreateAgentOptions, ItemParam } from '@apeira/core'
import type { Episode } from '@apeira/core/episodic'
import type { BaseEvent, Message, RunAgentInput } from '@copilotkit/react-core/v2'
import type { Subscriber } from 'rxjs'

import { createAgent } from '@apeira/core'
import {
  AbstractAgent,
  EventType,
} from '@copilotkit/react-core/v2'
import { Observable } from 'rxjs'

import { AGENT_ID, AGENT_NAME } from './const'
import { isItemEpisode } from './is-item-episode'

type PersistedMessageItem = Extract<ItemParam, { type: 'message' }>
interface PersistedThreadState {
  episodic?: string
}

type PersistedUserMessageItem = Extract<PersistedMessageItem, { role: 'user' }>
type UserContentPart = Exclude<Extract<Message, { role: 'user' }>['content'], string>[number]
type UserMediaContentPart = Extract<UserContentPart, { type: 'audio' | 'document' | 'image' | 'video' }>

const getStorageKey = (threadId: string) =>
  JSON.stringify([AGENT_NAME, threadId])

const toDataUrl = (mimeType: string, value: string) =>
  `data:${mimeType};base64,${value}`

const toContentSource = (source: UserMediaContentPart['source']) =>
  source.type === 'url'
    ? source.value
    : toDataUrl(source.mimeType, source.value)

const getPartFilename = (part: UserMediaContentPart) => {
  if ('metadata' in part && part.metadata != null && typeof part.metadata === 'object' && 'filename' in part.metadata && typeof part.metadata.filename === 'string')
    return part.metadata.filename

  return undefined
}

const getMimeTypeFromDataUrl = (value: string) => {
  const matched = /^data:([^;,]+)[;,]/.exec(value)
  return matched?.[1]
}

const toInputContentSource = (value: string) => {
  const mimeType = getMimeTypeFromDataUrl(value)

  if (mimeType != null) {
    const [, data = ''] = value.split(',', 2)
    return {
      mimeType,
      type: 'data' as const,
      value: data,
    }
  }

  return {
    type: 'url' as const,
    value,
  }
}

const getAttachmentType = (mimeType: string | undefined, filename: string | undefined) => {
  if (mimeType?.startsWith('image/'))
    return 'image' as const

  if (mimeType?.startsWith('audio/'))
    return 'audio' as const

  if (mimeType?.startsWith('video/'))
    return 'video' as const

  const normalizedFilename = filename?.toLowerCase()

  if (normalizedFilename != null) {
    if (/\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(normalizedFilename))
      return 'image' as const

    if (/\.(?:mp3|wav|ogg|m4a|aac|flac)$/i.test(normalizedFilename))
      return 'audio' as const

    if (/\.(?:mp4|webm|mov|mkv|avi)$/i.test(normalizedFilename))
      return 'video' as const
  }

  return 'document' as const
}

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
    // Future: add more part types as CopilotKit expands attachment support.
    // eslint-disable-next-line ts/switch-exhaustiveness-check
    switch (part.type) {
      case 'audio':
      case 'document':
      case 'video':
        content.push({
          file_data: part.source.type === 'data'
            ? toDataUrl(part.source.mimeType, part.source.value)
            : undefined,
          file_url: part.source.type === 'url'
            ? part.source.value
            : undefined,
          filename: getPartFilename(part),
          type: 'input_file',
        })
        break

      case 'image':
        content.push({
          image_url: toContentSource(part.source),
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

// eslint-disable-next-line sonarjs/function-return-type
const toUserMessageContent = (value: PersistedUserMessageItem['content']): Extract<Message, { role: 'user' }>['content'] => {
  if (typeof value === 'string')
    return value

  const content = value.flatMap((part): UserContentPart[] => {
    switch (part.type) {
      case 'input_file': {
        const sourceValue = part.file_url ?? part.file_data
        if (sourceValue == null)
          return []

        const source = toInputContentSource(sourceValue)
        const attachmentType = getAttachmentType(source.mimeType, part.filename ?? undefined)

        return [{
          metadata: part.filename == null
            ? undefined
            : { filename: part.filename },
          source,
          type: attachmentType,
        }]
      }

      case 'input_image':
        if (part.image_url == null)
          return []

        return [{
          source: toInputContentSource(part.image_url),
          type: 'image' as const,
        }]

      case 'input_text':
        return [{
          text: part.text,
          type: 'text' as const,
        }]

      default:
        return []
    }
  })

  return content.length > 0 ? content : toMessageText(value)
}

const readPersistedMessages = (threadId: string): Message[] => {
  try {
    const raw = localStorage.getItem(getStorageKey(threadId))
    if (raw == null)
      return []

    const state = JSON.parse(raw) as PersistedThreadState

    const items: ItemParam[] = []
    const lines = (state.episodic ?? '').split('\n')
    for (const line of lines) {
      if (!line.trim())
        continue
      try {
        const episode = JSON.parse(line) as Episode
        if (isItemEpisode(episode)) {
          items.push(episode.payload.item)
        }
      }
      catch {}
    }

    return items.flatMap((item): Message[] => {
      // Future: preserve additional persisted response item types when needed.
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
              content: toUserMessageContent(item.content),
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

export class AbstractApeiraAgent extends AbstractAgent {
  private readonly agent: Agent<unknown>
  private readonly agentOptions: CreateAgentOptions<unknown>
  private readonly onThreadUpdated?: (threadId: string) => void

  constructor(
    agentOptions: CreateAgentOptions<unknown>,
    onThreadUpdated?: (threadId: string) => void,
  ) {
    super({
      agentId: AGENT_ID,
      description: 'Apeira browser agent',
      initialMessages: readPersistedMessages('default'),
      threadId: 'default',
    })
    this.agentOptions = agentOptions
    this.agent = createAgent(agentOptions)
    this.onThreadUpdated = onThreadUpdated
  }

  clearThread() {
    this.agent.session({ id: this.threadId }).clear()
  }

  override clone(): this {
    const cloned = new AbstractApeiraAgent(this.agentOptions, this.onThreadUpdated) as this
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

      const session = this.agent.session({ id: this.threadId })
      let activeRunId: string | undefined

      const unsubscribe = session.subscribe('ag-ui', (aguiEvent) => {
        const eventThreadId = aguiEvent.threadId ?? (aguiEvent.rawEvent as undefined | { sessionId?: string })?.sessionId
        if (eventThreadId != null && eventThreadId !== this.threadId)
          return

        const eventRunId = aguiEvent.runId ?? (aguiEvent.rawEvent as undefined | { turnId?: string })?.turnId

        if (activeRunId == null && eventRunId != null)
          activeRunId = eventRunId as string

        if (activeRunId != null && eventRunId != null && eventRunId !== activeRunId)
          return

        if (aguiEvent.type === EventType.RUN_STARTED)
          this.isRunning = true

        if (aguiEvent.type === EventType.RUN_FINISHED || aguiEvent.type === EventType.RUN_ERROR)
          this.isRunning = false

        subscriber.next(aguiEvent)

        if (aguiEvent.type === EventType.RUN_FINISHED || aguiEvent.type === EventType.RUN_ERROR) {
          this.onThreadUpdated?.(this.threadId)
          subscriber.complete()
        }
      })

      const reader = session.run(userInput).getReader()

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
          session.abort('cancelled')
      }
    })
  }

  runDemoMessage(content: string, onEvent: (event: BaseEvent) => void, onDone?: () => void) {
    const input = this.prepareRunAgentInput()

    const subscription = this.run({
      ...input,
      messages: [{
        content,
        id: crypto.randomUUID(),
        role: 'user',
      }],
    }).subscribe({
      complete: onDone,
      error: () => onDone?.(),
      next: onEvent,
    })

    return () => subscription.unsubscribe()
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
