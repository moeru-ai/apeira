import { sleep } from '@moeru/std/sleep'

export { sleep }

export const createMockFetch = (opts?: { delayMs?: number, responseText?: string | string[] }) => {
  const { delayMs = 0, responseText = 'hello' } = opts ?? {}
  const bodies: Array<{ input: unknown[], instructions?: unknown, tools?: unknown[] }> = []
  const inputs: unknown[][] = []
  const instructionsArr: unknown[] = []
  let callIndex = 0

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const signal = init?.signal instanceof AbortSignal ? init.signal : undefined
    if (signal?.aborted)
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')

    const body = JSON.parse(String(init?.body)) as { input: unknown[], instructions?: unknown, tools?: unknown[] }
    bodies.push(body)
    inputs.push(body.input)
    instructionsArr.push(body.instructions)

    const text = Array.isArray(responseText)
      ? (responseText[callIndex] ?? responseText[responseText.length - 1] ?? 'hello')
      : responseText
    callIndex++

    const encoder = new TextEncoder()
    const assistantMsg = {
      content: [{ text, type: 'output_text' }],
      role: 'assistant',
      type: 'message',
    }

    return new Response(new ReadableStream({
      start: async (controller) => {
        const enqueue = async (event: unknown) => {
          if (signal?.aborted) {
            controller.error(signal.reason)
            return
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          if (delayMs > 0)
            await sleep(delayMs)
        }

        await enqueue({ type: 'response.created' })
        await enqueue({ item: assistantMsg, output_index: 0, type: 'response.output_item.done' })
        await enqueue({
          response: { output: [assistantMsg], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
          type: 'response.completed',
        })
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  }

  return { bodies, fetch, inputs, instructions: instructionsArr }
}
