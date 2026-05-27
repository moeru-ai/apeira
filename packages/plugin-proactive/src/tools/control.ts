import { tool } from '@xsai/tool'
import { z } from 'zod'

const sleepSchema = z.object({
  duration: z.string().describe('Duration to sleep, e.g. "5m", "30s", "1h".'),
  reason: z.string().optional().describe('Optional reason for sleeping.'),
})

export interface ControlCallbacks {
  onPause: () => void
  onResume: () => void
  onSleep: () => void
}

export const createControlTools = (callbacks: ControlCallbacks) => {
  const sleepTool = tool({
    description: 'Enter a resting state. Call this when there is nothing useful to do after a tick. This conserves tokens and respects the user\'s attention.',
    execute: (input: unknown) => {
      const args = z.parse(sleepSchema, input)
      callbacks.onSleep()
      return `Sleeping for ${args.duration}. Next tick will arrive after that. Reason: ${args.reason ?? 'idle'}`
    },
    name: 'sleep',
    parameters: sleepSchema,
  })

  const pauseTool = tool({
    description: 'Pause all proactive behavior. The agent will stop receiving ticks until resume_proactive is called.',
    execute: () => {
      callbacks.onPause()
      return 'Proactive behavior paused. Use resume_proactive to resume.'
    },
    name: 'pause_proactive',
    parameters: z.object({}),
  })

  const resumeTool = tool({
    description: 'Resume proactive behavior after a pause.',
    execute: () => {
      callbacks.onResume()
      return 'Proactive behavior resumed.'
    },
    name: 'resume_proactive',
    parameters: z.object({}),
  })

  return [sleepTool, pauseTool, resumeTool]
}
