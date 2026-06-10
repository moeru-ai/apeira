import type {
  AssistantMessage,
  CommonContentPart,
  DeveloperMessage,
  Message,
  RefusalContentPart,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '@xsai/shared-chat'

import type { ItemParam } from '../types/base'
import type {
  AgentAssistantMessageInput,
  AgentDeveloperMessageInput,
  AgentFunctionCallOutputInput,
  AgentInput,
  AgentSystemMessageInput,
  AgentUserMessageInput,
} from '../types/input'

type ChatContentPart = CommonContentPart | RefusalContentPart
type FunctionOutputContentPart = Exclude<AgentFunctionCallOutputInput['output'], string>[number]
type InputContentPart = Exclude<AgentUserMessageInput['content'], string>[number]
type OutputContentPart = Exclude<AgentAssistantMessageInput['content'], string>[number]
type ResponsesContentPart = FunctionOutputContentPart | InputContentPart | OutputContentPart

export const toResponses = (inputs: readonly AgentInput[]): ItemParam[] =>
  inputs.flatMap((input): ItemParam[] => {
    if (input.type !== 'message' || input.role !== 'assistant')
      return [input]

    const message: ItemParam = {
      content: input.content,
      id: input.id,
      phase: input.phase,
      role: 'assistant',
      status: input.status,
      type: 'message',
    }

    return [
      message,
      ...(input.tool_calls?.map((toolCall): ItemParam => ({
        arguments: toolCall.function.arguments ?? '',
        call_id: toolCall.id,
        name: toolCall.function.name ?? '',
        type: 'function_call',
      })) ?? []),
    ]
  })

export const fromResponses = (inputs: ItemParam[]): AgentInput[] =>
  inputs as AgentInput[]

export const toChat = (inputs: readonly AgentInput[]): Message[] => {
  const partToChat = (part: ResponsesContentPart): ChatContentPart[] => {
    switch (part.type) {
      case 'input_file':
        return [{
          file: {
            file_data: part.file_data ?? undefined,
            filename: part.filename ?? undefined,
          },
          type: 'file',
        }]
      case 'input_image':
        return [{
          image_url: {
            detail: part.detail ?? undefined,
            url: part.image_url ?? '',
          },
          type: 'image_url',
        }]
      case 'input_text':
      case 'output_text':
        return [{ text: part.text, type: 'text' }]
      case 'input_video':
        return []
      case 'refusal':
        return [{ refusal: part.refusal, type: 'refusal' }]
    }
  }

  return inputs.flatMap((input): Message[] => {
    if (input.type === 'message') {
      const content = typeof input.content === 'string'
        ? input.content
        : input.content.flatMap(partToChat)

      switch (input.role) {
        case 'assistant':
          return [{
            content: content as AssistantMessage['content'],
            reasoning: input.reasoning,
            reasoning_content: input.reasoning_content,
            refusal: input.refusal,
            role: 'assistant',
            tool_calls: input.tool_calls,
          }]
        case 'developer':
          return [{ content: content as DeveloperMessage['content'], role: 'developer' }]
        case 'system':
          return [{ content: content as SystemMessage['content'], role: 'system' }]
        case 'user':
          return [{ content: content as UserMessage['content'], role: 'user' }]
      }
    }

    if (input.type === 'function_call') {
      return [{
        content: '',
        role: 'assistant',
        tool_calls: [{
          function: {
            arguments: input.arguments,
            name: input.name,
          },
          id: input.call_id,
          type: 'function',
        }],
      }]
    }

    if (input.type === 'function_call_output') {
      const content: ToolMessage['content'] = typeof input.output === 'string'
        ? input.output
        : input.output.flatMap(partToChat) as ToolMessage['content']

      return [{
        content,
        role: 'tool',
        tool_call_id: input.call_id,
      }]
    }

    return []
  })
}

export const fromChat = (messages: readonly Message[]): AgentInput[] => {
  const partToInput = (part: ChatContentPart): Array<InputContentPart | OutputContentPart> => {
    switch (part.type) {
      case 'file':
        return [{
          file_data: part.file.file_data ?? null,
          filename: part.file.filename ?? null,
          type: 'input_file',
        }]
      case 'image_url':
        return [{
          detail: part.image_url.detail ?? null,
          image_url: part.image_url.url,
          type: 'input_image',
        }]
      case 'input_audio':
        return []
      case 'refusal':
        return [{ refusal: part.refusal, type: 'refusal' }]
      case 'text':
        return [{ text: part.text, type: 'input_text' }]
    }
  }

  const assistantToInput = (message: AssistantMessage): AgentAssistantMessageInput => {
    let content: AgentAssistantMessageInput['content']

    if (message.content == null) {
      content = message.refusal == null
        ? ''
        : [{ refusal: message.refusal, type: 'refusal' }]
    }
    else if (typeof message.content === 'string') {
      content = message.content
    }
    else {
      content = message.content.map((part): OutputContentPart =>
        part.type === 'text'
          ? { text: part.text, type: 'output_text' }
          : { refusal: part.refusal, type: 'refusal' })
    }

    return {
      content,
      reasoning: message.reasoning,
      reasoning_content: message.reasoning_content,
      refusal: message.refusal,
      role: 'assistant',
      tool_calls: message.tool_calls,
      type: 'message',
    }
  }

  return messages.map((message): AgentInput => {
    if (message.role === 'assistant')
      return assistantToInput(message)

    const content = typeof message.content === 'string'
      ? message.content
      : message.content.flatMap(partToInput)

    switch (message.role) {
      case 'developer':
        return {
          content: content as AgentDeveloperMessageInput['content'],
          role: 'developer',
          type: 'message',
        }
      case 'system':
        return {
          content: content as AgentSystemMessageInput['content'],
          role: 'system',
          type: 'message',
        }
      case 'tool':
        return {
          call_id: message.tool_call_id,
          output: content as AgentFunctionCallOutputInput['output'],
          type: 'function_call_output',
        }
      case 'user':
        return {
          content: content as AgentUserMessageInput['content'],
          role: 'user',
          type: 'message',
        }
    }

    throw new TypeError('Unsupported chat message role')
  })
}
