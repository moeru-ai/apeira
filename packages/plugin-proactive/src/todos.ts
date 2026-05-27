export interface Todo {
  createdAt: number
  id: string
  status: 'done' | 'in_progress' | 'pending'
  title: string
  updatedAt?: number
}

export class TodoList {
  private todos = new Map<string, Todo>()

  static fromArray(todos: Todo[]): TodoList {
    const list = new TodoList()
    for (const todo of todos)
      list.todos.set(todo.id, todo)
    return list
  }

  create(title: string): string {
    const id = crypto.randomUUID()
    const todo: Todo = {
      createdAt: Date.now(),
      id,
      status: 'pending',
      title,
    }
    this.todos.set(id, todo)
    return id
  }

  getActive(): Todo[] {
    return this.list().filter(t => t.status === 'pending' || t.status === 'in_progress')
  }

  list(): Todo[] {
    return [...this.todos.values()]
  }

  update(id: string, updates: Partial<Pick<Todo, 'status' | 'title'>>): boolean {
    const todo = this.todos.get(id)
    if (todo == null)
      return false

    if (updates.title != null)
      todo.title = updates.title
    if (updates.status != null)
      todo.status = updates.status

    todo.updatedAt = Date.now()
    return true
  }
}
