import type { ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { Agent } from './agent'

export const run = (agent: Agent, input: ItemParam) => new ReadableStream<AgentEvent>({
  cancel: () => {
    agent.abort('stream cancelled')
  },
  start: (controller) => {
    const unsubscribe = agent.subscribe('apeira', (event) => {
      controller.enqueue(event)
      if (event.type === 'turn.done' || event.type === 'turn.failed' || event.type === 'turn.aborted') {
        controller.close()
        unsubscribe()
      }
    })
    agent.send(input)
  },
})
