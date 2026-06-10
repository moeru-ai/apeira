import type { ItemParam } from '@apeira/core'

export const createMockFetch = (opts?: {
  responseItem?: ItemParam | ItemParam[]
  responseText?: string | string[]
  totalTokens?: number | number[]
}) => {
  const { responseItem, responseText = 'ok', totalTokens = 2 } = opts ?? {}
  const bodies: Array<{ input: unknown[], instructions?: unknown }> = []
  let callIndex = 0

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: unknown[], instructions?: unknown }
    bodies.push(body)

    const text = Array.isArray(responseText)
      ? (responseText[callIndex] ?? responseText.at(-1) ?? 'ok')
      : responseText
    const usage = Array.isArray(totalTokens)
      ? (totalTokens[callIndex] ?? totalTokens.at(-1) ?? 2)
      : totalTokens
    callIndex++

    const encoder = new TextEncoder()
    const defaultAssistant: ItemParam = { content: [{ text, type: 'output_text' }], role: 'assistant', type: 'message' }
    const assistant = Array.isArray(responseItem)
      ? (responseItem[callIndex - 1] ?? responseItem.at(-1) ?? defaultAssistant)
      : responseItem ?? defaultAssistant

    return new Response(new ReadableStream({
      start: (controller) => {
        const outputItemDone = JSON.stringify({
          item: assistant,
          output_index: 0,
          type: 'response.output_item.done',
        })
        const responseCompleted = JSON.stringify({
          response: {
            output: [assistant],
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: usage,
            },
          },
          type: 'response.completed',
        })

        controller.enqueue(encoder.encode('data: {"type":"response.created"}\n\n'))
        controller.enqueue(encoder.encode(`data: ${outputItemDone}\n\n`))
        controller.enqueue(encoder.encode(`data: ${responseCompleted}\n\n`))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  }

  return { bodies, fetch }
}
