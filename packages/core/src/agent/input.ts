import type { ToolCall } from '@xsai/shared-chat'

import type { ItemParam } from '../types'

export interface AgentAssistantMessageInput extends Extract<ItemParam, { role: 'assistant', type: 'message' }> {
  reasoning?: string
  reasoning_content?: string
  refusal?: string
  tool_calls?: ToolCall[]
}

export type AgentCompactionInput = Extract<ItemParam, { type: 'compaction' }>

export type AgentDeveloperMessageInput = Extract<ItemParam, { role: 'developer', type: 'message' }>

export type AgentFunctionCallInput = Extract<ItemParam, { type: 'function_call' }>

export type AgentFunctionCallOutputInput = Extract<ItemParam, { type: 'function_call_output' }>

export type AgentInput = AgentAssistantMessageInput | Exclude<ItemParam, { role: 'assistant' }>

export type AgentItemReferenceInput = Extract<ItemParam, { id: string }>

export type AgentReasoningInput = Extract<ItemParam, { type: 'reasoning' }>

export type AgentSystemMessageInput = Extract<ItemParam, { role: 'system', type: 'message' }>

export type AgentUserMessageInput = Extract<ItemParam, { role: 'user', type: 'message' }>

const message = <T>(role: string) => (content: string | TemplateStringsArray, ...substitutions: unknown[]) => ({
  content: (typeof content === 'string') ? content : String.raw(content, ...substitutions),
  role,
  type: 'message',
}) as T

export const assistant = (content: string | TemplateStringsArray, ...substitutions: unknown[]): AgentAssistantMessageInput => ({
  content: [{
    text: (typeof content === 'string') ? content : String.raw(content, ...substitutions),
    type: 'output_text',
  }],
  role: 'assistant',
  type: 'message',
})

export const developer = message<AgentDeveloperMessageInput>('developer')

export const system = message<AgentSystemMessageInput>('system')

export const user = message<AgentUserMessageInput>('user')
