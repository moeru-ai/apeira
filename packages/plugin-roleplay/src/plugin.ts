import type { Agent, AgentInput, AgentPlugin, AgentState } from '@apeira/core'
import type { CharacterCardV3 } from '@risuai/ccardlib'

import type {
  RoleplayEvent,
  RoleplayPluginOptions,
  RoleplayPromptCategory,
} from './types'
import type { CBSContext } from './utils/cbs'

import { assistant, system } from '@apeira/core'

import { name, version } from '../package.json'
import { renderCBS } from './utils/cbs'
import { selectGreeting } from './utils/greeting'
import { normalizeCard } from './utils/normalize'
import {
  assembleCharacterDefinition,
  assembleInstructionExtension,
  assemblePostHistoryInstructions,
} from './utils/prompt'

export const roleplay = (options: RoleplayPluginOptions): AgentPlugin => {
  let agent: Agent | undefined
  let card: CharacterCardV3 | undefined
  let greetingIndex = 0
  let activeTurnId: string | undefined
  let instructionExtension = ''
  let unsubscribe: (() => void) | undefined
  const turnPickCache = new Map<string, string>()

  const getCard = () => {
    if (card == null)
      throw new Error('[@apeira/plugin-roleplay] Plugin is not initialized.')

    return card
  }

  const getAgent = () => {
    if (agent == null)
      throw new Error('[@apeira/plugin-roleplay] Plugin is not initialized.')

    return agent
  }

  const emit = async (event: RoleplayEvent) => getAgent().emit('roleplay', event)

  const createCBSContext = (
    pickCache = turnPickCache,
    state: Readonly<AgentState> = getAgent().state.get(),
  ): CBSContext => ({
    charName: getCard().data.nickname ?? getCard().data.name,
    pickCache,
    userName: typeof state.userName === 'string' ? state.userName : undefined,
  })

  const restoreGreeting = async () => {
    const activeAgent = getAgent()
    const selected = selectGreeting(getCard(), greetingIndex)
    const rendered = renderCBS(selected.greeting, createCBSContext(new Map())).text

    const history = await activeAgent.store.read()
    if (history.length === 0 && rendered.length > 0)
      await activeAgent.store.append(assistant(rendered))

    return rendered.length > 0
  }

  return {
    enforce: 'post',
    extendInstructions: ({ state }) => {
      instructionExtension = assembleInstructionExtension(
        getCard(),
        createCBSContext(turnPickCache, state),
      )
      return instructionExtension.length > 0 ? instructionExtension : undefined
    },
    init: async (nextAgent) => {
      agent = nextAgent
      card = normalizeCard(options.card)
      greetingIndex = selectGreeting(card, options.greetingIndex).index

      unsubscribe = nextAgent.subscribe('apeira', async (event) => {
        if (event.type === 'turn.start') {
          activeTurnId = event.turnId
          turnPickCache.clear()
          instructionExtension = ''
        }
        else if (event.type === 'agent.cleared') {
          activeTurnId = undefined
          turnPickCache.clear()
          instructionExtension = ''
          await restoreGreeting()
          await emit({ greetingIndex, type: 'session.reset' })
        }
      })

      const hadContent = await restoreGreeting()
      await emit({ greetingIndex, hadContent, type: 'greeting.selected' })
    },
    name,
    prepareStep: (stepOptions) => {
      const context = createCBSContext()
      const definition = assembleCharacterDefinition(getCard(), context)
      const postHistoryInstructions = assemblePostHistoryInstructions(getCard(), context)
      const characterInput: AgentInput[] = definition.length > 0
        ? [system(definition)]
        : []
      const postHistoryInput: AgentInput[] = postHistoryInstructions.length > 0
        ? [system(postHistoryInstructions)]
        : []
      const temporaryInput = [
        ...characterInput,
        ...postHistoryInput,
      ]
      const categories: RoleplayPromptCategory[] = []

      if (instructionExtension.length > 0 || characterInput.length > 0)
        categories.push('character')
      if (postHistoryInput.length > 0)
        categories.push('post_history_instructions')

      void emit({
        categories,
        instructionExtension,
        temporaryInput,
        turnId: activeTurnId,
        type: 'prompt.assembled',
      })

      return temporaryInput.length > 0
        ? { input: [...characterInput, ...stepOptions.input, ...postHistoryInput] }
        : {}
    },
    stop: () => {
      unsubscribe?.()
      unsubscribe = undefined
      activeTurnId = undefined
      instructionExtension = ''
      turnPickCache.clear()
      agent = undefined
      card = undefined
    },
    version,
  }
}
