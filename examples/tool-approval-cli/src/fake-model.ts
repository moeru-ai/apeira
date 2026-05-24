import type { ItemParam } from '@apeira/core'

export interface FakeModelCall {
  input: Record<string, unknown>
  toolName: string
}

export interface FakeModelOptions {
  onPreToolMessage?: (text: string) => void
}

export interface FakeModelResult {
  fetch: typeof globalThis.fetch
  inputs: unknown[][]
}

export interface FakeModelTurn {
  calls: FakeModelCall[]
  prompt: string
}

const assistantMessage = (text: string, phase: 'final_answer' | 'pre_tool' = 'final_answer') => ({
  content: [{ text, type: 'output_text' }],
  phase,
  role: 'assistant',
  type: 'message',
})

const preToolMessageForTurn = (turn: FakeModelTurn) => {
  const commands = turn.calls
    .map(call => call.input.command)
    .filter((command): command is string => typeof command === 'string')

  if (commands.includes('rm -rf .'))
    return 'I need to inspect a risky command before I can continue. I will request approval before doing anything destructive.'

  if (commands.length > 1)
    return 'I will check the repository status more than once in this turn so the approval scope behavior is visible.'

  return 'I will check the repository status first, then use the result to answer.'
}

const extractAssistantText = (output: unknown, options: { includePreTool?: boolean } = {}) => {
  if (output == null || typeof output !== 'object')
    return undefined

  const item = output as { content?: Array<{ text?: string, type?: string }>, phase?: string, role?: string, type?: string }
  if (
    item.type !== 'message'
    || item.role !== 'assistant'
    || item.content == null
    || (!options.includePreTool && item.phase === 'pre_tool')
  ) {
    return undefined
  }

  const text = item.content
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')

  return text.length > 0 ? text : undefined
}

const sse = (event: unknown) =>
  `data: ${JSON.stringify(event)}\n\n`

const createResponseStream = (outputs: unknown[]) => {
  const encoder = new TextEncoder()

  return new Response(new ReadableStream({
    start: (controller) => {
      controller.enqueue(encoder.encode(sse({ type: 'response.created' })))
      outputs.forEach((item, outputIndex) => {
        controller.enqueue(encoder.encode(sse({
          item,
          output_index: outputIndex,
          type: 'response.output_item.done',
        })))
      })
      controller.enqueue(encoder.encode(sse({
        response: {
          output: outputs,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        },
        type: 'response.completed',
      })))
      controller.close()
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

export const createUserMessage = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

export const createFakeModelFetch = (
  turns: FakeModelTurn[],
  options: FakeModelOptions = {},
): FakeModelResult => {
  const outputs = turns.flatMap((turn, turnIndex) => [
    [
      assistantMessage(preToolMessageForTurn(turn), 'pre_tool'),
      ...turn.calls.map((call, callIndex) => ({
        arguments: JSON.stringify(call.input),
        call_id: `call_${turnIndex}_${callIndex}`,
        id: `fc_${turnIndex}_${callIndex}`,
        name: call.toolName,
        status: 'completed',
        type: 'function_call',
      })),
    ],
    [assistantMessage(`finished ${turn.prompt}`)],
  ])
  const inputs: unknown[][] = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input?: unknown[] }
    inputs.push(body.input ?? [])

    const output = outputs.shift() ?? [assistantMessage('finished')]
    if (output.some(item => (item as { type?: string }).type === 'function_call')) {
      const assistantText = output.map(item => extractAssistantText(item, { includePreTool: true })).find(text => text != null)
      if (assistantText != null)
        options.onPreToolMessage?.(assistantText)
    }
    return createResponseStream(output)
  }

  return { fetch, inputs }
}
