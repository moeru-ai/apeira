import type { ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { Agent } from './agent'
import type { AgentSendOptions } from './queue'

export const run = (agent: Agent, input: ItemParam, options?: AgentSendOptions) => {
  let unsubscribe: (() => void) | undefined

  return new ReadableStream<AgentEvent>({
    cancel: () => {
      unsubscribe?.()
      agent.abort('stream cancelled')
    },
    start: (controller) => {
      unsubscribe = agent.subscribe('apeira', (event) => {
        controller.enqueue(event)
        if (event.type === 'turn.done' || event.type === 'turn.failed' || event.type === 'turn.aborted') {
          controller.close()
          unsubscribe?.()
        }
      })

      try {
        agent.send(input, options)
      }
      catch (error) {
        unsubscribe?.()
        controller.error(error)
      }
    },
  })
}
