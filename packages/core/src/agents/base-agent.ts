export interface BaseAgentOptions {
  agents?: BaseAgent[]
  description?: string
  name: string
  plugins?: BaseAgentPlugin[]
}

export interface BaseAgentPlugin {
  close?: () => Promise<void> | void
  name: string
  version: string
}

export class BaseAgent<I = unknown, O = unknown, I2 = undefined> {
  public agents: BaseAgent[] = []
  public description?: string
  public name: string
  public plugins: BaseAgentPlugin[] = []

  constructor(options: BaseAgentOptions) {
    this.name = options.name

    if (options.description != null)
      this.description = options.description

    if (options.agents)
      this.agents = options.agents

    if (options.plugins)
      this.plugins = options.plugins
  }

  public clone(update: Partial<Omit<this, 'parentAgent'>> = {}): this {
    const newProps = { ...this, ...update }

    const clonedAgent = new (this.constructor as new (
      options: unknown
    ) => this)(newProps)

    if (!('agents' in update))
      clonedAgent.agents = this.agents.map(agent => agent.clone())

    return clonedAgent
  }

  public async close(): Promise<void> {
    await Promise.all(this.plugins
      .filter(plugin => 'close' in plugin)
      .map(async plugin => plugin.close!()))

    await Promise.all(this.agents.map(async agent => agent.close()))
  }

  public run(_task: I, _extraOptions?: I2): O {
    throw new Error(`'run' for ${this.constructor.name} is not implemented.`)
  }
}
