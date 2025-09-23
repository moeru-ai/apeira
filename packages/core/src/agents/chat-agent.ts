import type { ChatOptions, CommonContentPart, Message, Tool } from '@xsai/shared-chat'
import type { StreamTextOptions, StreamTextResult } from '@xsai/stream-text'

import { streamText } from '@xsai/stream-text'

import type { BaseAgentOptions, BaseAgentPlugin } from './base-agent'

import { BaseAgent } from './base-agent'

export interface ChatAgentOptions extends BaseAgentOptions {
  instruction: string
  llm: Omit<ChatOptions, 'messages' | 'tools'>
  tools?: Tool[]
}

export interface ChatAgentPlugin extends BaseAgentPlugin {
  onEvent?: StreamTextOptions['onEvent']
  onFinish?: StreamTextOptions['onFinish']
  onStepFinish?: StreamTextOptions['onStepFinish']
  tools?: Tool[]
  transformMessages?: (message: Message[]) => Message[]
}

export interface ChatAgentRunOptions {
  messages?: Message[]
}

export class ChatAgent extends BaseAgent implements BaseAgent<
  CommonContentPart[] | string,
  StreamTextResult,
  ChatAgentRunOptions
> {
  public instruction: string
  public llm: Omit<ChatOptions, 'messages' | 'tools'>
  public tools?: Tool[]

  constructor(options: ChatAgentOptions) {
    super(options)

    this.instruction = options.instruction
    this.llm = options.llm

    if (options.tools)
      this.tools = options.tools
  }

  public run(content: CommonContentPart[] | string, options?: ChatAgentRunOptions) {
    let messages = options?.messages ?? [{
      content: this.instruction,
      role: 'system',
    }]

    this.plugins
      .filter(plugin => 'transformMessages' in plugin)
      .forEach((plugin) => { messages = (plugin as ChatAgentPlugin).transformMessages!(messages) })

    return streamText({
      ...this.llm,
      baseURL: this.llm.baseURL,
      messages: [
        ...messages,
        {
          content,
          role: 'user',
        },
      ],
      model: this.llm.model,
      onEvent: event => this.plugins
        .filter(plugin => 'onEvent' in plugin)
        .forEach(plugin => (plugin as ChatAgentPlugin).onEvent!(event)),
      onFinish: step => this.plugins
        .filter(plugin => 'onFinish' in plugin)
        .forEach(plugin => (plugin as ChatAgentPlugin).onFinish!(step)),
      onStepFinish: step => this.plugins
        .filter(plugin => 'onStepFinish' in plugin)
        .forEach(plugin => (plugin as ChatAgentPlugin).onStepFinish!(step)),
      tools: this.tools,
    })
  }
}
