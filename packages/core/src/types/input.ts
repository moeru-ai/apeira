import type { ToolCall } from '@xsai/shared-chat'

import type { ItemParam } from './base'

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

export type AgentInput = AgentAssistantMessageInput | AgentCompactionInput | AgentDeveloperMessageInput | AgentFunctionCallInput | AgentFunctionCallOutputInput | AgentItemReferenceInput | AgentReasoningInput | AgentSystemMessageInput | AgentUserMessageInput

export type AgentItemReferenceInput = Extract<ItemParam, { type: 'item_reference' }>

export type AgentReasoningInput = Extract<ItemParam, { type: 'reasoning' }>

export type AgentSystemMessageInput = Extract<ItemParam, { role: 'system', type: 'message' }>

export type AgentUserMessageInput = Extract<ItemParam, { role: 'user', type: 'message' }>
