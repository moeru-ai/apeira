import type { Scheduler } from '../scheduler'

import { tool } from '@xsai/tool'
import { z } from 'zod'

const MIN_INTERVAL_SECONDS = 60

const scheduleTaskSchema = z.object({
  at: z.number().optional().describe('For "once": delay in seconds before triggering. 0 means immediately.'),
  description: z.string().describe('What the task should do when triggered.'),
  interval: z.number().optional().describe('For "interval": interval in seconds (minimum 60).'),
  type: z.enum(['once', 'interval']).describe('Task type: once or interval.'),
})

const unscheduleTaskSchema = z.object({
  id: z.string().describe('Task ID to remove.'),
})

export const createScheduleTools = (scheduler: Scheduler) => {
  const scheduleTaskTool = tool({
    description: 'Schedule a future task that will appear in a tick when due.',
    execute: (input: unknown) => {
      const args = z.parse(scheduleTaskSchema, input)

      if (args.type === 'once') {
        const delay = (args.at ?? 0) * 1000
        const at = Date.now() + delay
        const id = scheduler.add({ at, description: args.description, type: 'once' })
        return `Scheduled task ${id} at ${new Date(at).toISOString()}`
      }

      const intervalSeconds = Math.max(args.interval ?? 60, MIN_INTERVAL_SECONDS)
      const interval = intervalSeconds * 1000
      const id = scheduler.add({ description: args.description, interval, type: 'interval' })
      return `Scheduled recurring task ${id} every ${intervalSeconds}s`
    },
    name: 'schedule_task',
    parameters: scheduleTaskSchema,
  })

  const unscheduleTaskTool = tool({
    description: 'Remove a previously scheduled task by ID.',
    execute: (input: unknown) => {
      const args = z.parse(unscheduleTaskSchema, input)
      const removed = scheduler.remove(args.id)
      return removed ? `Removed task ${args.id}` : `Task ${args.id} not found`
    },
    name: 'unschedule_task',
    parameters: unscheduleTaskSchema,
  })

  const listScheduledTasksTool = tool({
    description: 'List all currently scheduled tasks.',
    execute: () => {
      const tasks = scheduler.list()
      if (tasks.length === 0)
        return 'No scheduled tasks.'
      return tasks.map(t => `- ${t.id}: [${t.type}] ${t.description}`).join('\n')
    },
    name: 'list_scheduled_tasks',
    parameters: z.object({}),
  })

  return [scheduleTaskTool, unscheduleTaskTool, listScheduledTasksTool]
}
