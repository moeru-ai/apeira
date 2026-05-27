export interface ScheduledTask {
  at?: number
  createdAt: number
  description: string
  id: string
  interval?: number
  lastTriggeredAt?: number
  type: 'interval' | 'once'
}

export class Scheduler {
  private tasks = new Map<string, ScheduledTask>()

  static fromArray(tasks: ScheduledTask[]): Scheduler {
    const scheduler = new Scheduler()
    for (const task of tasks) {
      if (!task.createdAt)
        task.createdAt = Date.now()
      scheduler.tasks.set(task.id, task)
    }
    return scheduler
  }

  add(task: Omit<ScheduledTask, 'createdAt' | 'id'>): string {
    const id = crypto.randomUUID()
    this.tasks.set(id, { createdAt: Date.now(), ...task, id })
    return id
  }

  /** Get currently due tasks (one-time tasks due / recurring tasks ready to trigger) */
  due(now = Date.now()): ScheduledTask[] {
    const dueTasks: ScheduledTask[] = []

    for (const task of this.tasks.values()) {
      if (task.type === 'once' && task.at != null && task.at <= now) {
        dueTasks.push(task)
      }
      if (task.type === 'interval' && task.interval != null) {
        const last = task.lastTriggeredAt ?? task.createdAt
        if (now - last >= task.interval) {
          dueTasks.push(task)
        }
      }
    }

    return dueTasks
  }

  list(): ScheduledTask[] {
    return [...this.tasks.values()]
  }

  prune(now = Date.now()): void {
    for (const [id, task] of this.tasks) {
      if (task.type === 'once' && task.at != null && task.at <= now) {
        this.tasks.delete(id)
      }
    }
  }

  remove(id: string): boolean {
    return this.tasks.delete(id)
  }
}
