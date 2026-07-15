import type { Tool, ToolExecuteOptions } from '@xsai/shared-chat'
import type { Schema, SchemaWithJson } from 'xsschema'

import type { MaybePromise } from '../types/base'
import type { AgentInput } from '../types/input'
import type { Agent } from './agent'

import { defineTool, rawTool } from '@xsai/tool'

import { user } from './input'
import { run } from './run'

export interface AsToolOptions<TParameters = { input: string }, TSchema extends Schema & SchemaWithJson = Schema & SchemaWithJson> {
  description?: string
  name?: string
  parameters?: TSchema
  strict?: boolean
  toAgentInput?: (parameters: TParameters) => MaybePromise<AgentInput>
}

const getToolName = (agent: Agent, name?: string) => {
  const resolved = name ?? agent.state.get().agentName

  if (resolved == null)
    throw new Error('asTool() requires options.name or agent.state.agentName.')

  if (!/^[\w-]{1,64}$/.test(resolved))
    throw new Error(`Invalid tool name: ${resolved}. Tool names must match /^[A-Za-z0-9_-]{1,64}$/.`)

  return resolved
}

const runAsTool = <T>(
  agent: Agent,
  toAgentInput: (parameters: T) => MaybePromise<AgentInput>,
) => async (parameters: T, options: ToolExecuteOptions) => {
  if (options.abortSignal?.aborted)
    throw options.abortSignal.reason ?? new DOMException('The operation was aborted.', 'AbortError')

  const input = await toAgentInput(parameters)

  const doneText: string[] = []
  const deltaText: string[] = []

  for await (const event of run(agent, input, { signal: options.abortSignal })) {
    // eslint-disable-next-line ts/switch-exhaustiveness-check
    switch (event.type) {
      case 'text.delta':
        deltaText.push(event.delta)
        break
      case 'text.done':
        doneText.push(event.content)
        break
      case 'turn.failed':
        throw event.error
      case 'turn.aborted':
        throw event.reason ?? new DOMException('The operation was aborted.', 'AbortError')
    }
  }

  return (doneText.length > 0 ? doneText : deltaText).join('')
}

interface AsTool {
  <TSchema extends Schema & SchemaWithJson>(
    agent: Agent,
    options: AsToolOptions<Schema.InferOutput<TSchema>, TSchema> & { parameters: TSchema },
  ): Tool
  (agent: Agent, options?: AsToolOptions): Tool
}

export const asTool: AsTool = (
  agent: Agent,
  options: AsToolOptions = {},
) => {
  const toolName = getToolName(agent, options.name)
  const toolDescription = options.description ?? agent.state.get().agentDescription ?? ''

  if (options.parameters == null) {
    return rawTool<{ input: string }>({
      description: toolDescription,
      execute: runAsTool(agent, options.toAgentInput ?? (parameters => user(parameters.input))),
      name: toolName,
      parameters: {
        additionalProperties: false,
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
        type: 'object',
      },
      strict: options.strict,
    })
  }

  return defineTool({
    description: toolDescription,
    execute: runAsTool(agent, options.toAgentInput as
    | ((parameters: unknown) => MaybePromise<AgentInput>)
    | undefined
    ?? ((parameters: unknown) => user(JSON.stringify(parameters) ?? ''))),
    name: toolName,
    parameters: options.parameters,
    strict: options.strict,
  })
}
