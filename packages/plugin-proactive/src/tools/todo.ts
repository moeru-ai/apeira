import type { TodoList } from '../todos'

import { tool } from '@xsai/tool'
import { z } from 'zod'

const createTodoSchema = z.object({
  title: z.string().describe('Title of the todo item.'),
})

const updateTodoSchema = z.object({
  id: z.string().describe('Todo ID to update.'),
  status: z.enum(['pending', 'in_progress', 'done']).optional().describe('New status.'),
  title: z.string().optional().describe('New title.'),
})

export const createTodoTools = (todos: TodoList) => {
  const createTodoTool = tool({
    description: 'Create a new todo item to track work.',
    execute: (input: unknown) => {
      const args = z.parse(createTodoSchema, input)
      const id = todos.create(args.title)
      return `Created todo ${id}: ${args.title}`
    },
    name: 'create_todo',
    parameters: createTodoSchema,
  })

  const updateTodoTool = tool({
    description: 'Update a todo item status or title.',
    execute: (input: unknown) => {
      const args = z.parse(updateTodoSchema, input)
      const updated = todos.update(args.id, { status: args.status, title: args.title })
      return updated ? `Updated todo ${args.id}` : `Todo ${args.id} not found`
    },
    name: 'update_todo',
    parameters: updateTodoSchema,
  })

  const listTodosTool = tool({
    description: 'List all todos, especially active ones.',
    execute: () => {
      const list = todos.list()
      if (list.length === 0)
        return 'No todos.'
      return list.map(t => `- [${t.status}] ${t.id}: ${t.title}`).join('\n')
    },
    name: 'list_todos',
    parameters: z.object({}),
  })

  return [createTodoTool, updateTodoTool, listTodosTool]
}
