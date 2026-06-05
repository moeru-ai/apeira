import type { ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { Agent } from './agent'
import type { AgentSendOptions } from './queue'

const isTerminalTurnEvent = (event: AgentEvent) =>
  event.type === 'turn.done' || event.type === 'turn.failed' || event.type === 'turn.aborted'

export const run = (agent: Agent, input: ItemParam, options?: AgentSendOptions) => {
  let turnId: string | undefined
  let unsubscribe: (() => void) | undefined

  return new ReadableStream<AgentEvent>({
    cancel: () => {
      unsubscribe?.()
      agent.abort('stream cancelled')
    },
    start: (controller) => {
      const send = () => {
        if (turnId != null)
          return

        try {
          turnId = agent.send(input, options)
        }
        catch (error) {
          unsubscribe?.()
          controller.error(error)
        }
      }

      let waitingTurnId: string | undefined

      unsubscribe = agent.subscribe('apeira', (event) => {
        if (turnId == null) {
          if (isTerminalTurnEvent(event) && event.turnId === waitingTurnId)
            send()
          return
        }

        if (event.turnId !== turnId)
          return

        controller.enqueue(event)
        if (isTerminalTurnEvent(event)) {
          controller.close()
          unsubscribe?.()
        }
      })

      waitingTurnId = agent.getActiveTurnId()
      if (waitingTurnId == null)
        send()
    },
  })
}
