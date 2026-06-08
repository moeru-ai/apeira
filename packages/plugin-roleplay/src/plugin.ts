import type { Agent, AgentPlugin, AgentState, ItemParam } from '@apeira/core'
import type { CharacterCardV3 } from '@risuai/ccardlib'

import type {
  RoleplayEvent,
  RoleplayPluginOptions,
  RoleplayPromptCategory,
} from './types'
import type { CBSContext } from './utils/cbs'

import { name, version } from '../package.json'
import { renderCBS } from './utils/cbs'
import { selectGreeting } from './utils/greeting'
import { assistantMessage, systemMessage } from './utils/message'
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

  const emit = (event: RoleplayEvent) => getAgent().emit('roleplay', event)

  const createCBSContext = (
    pickCache = turnPickCache,
    state: AgentState = getAgent().getState(),
  ): CBSContext => ({
    charName: getCard().data.nickname ?? getCard().data.name,
    pickCache,
    userName: typeof state.userName === 'string' ? state.userName : undefined,
  })

  const restoreGreeting = () => {
    const activeAgent = getAgent()
    const selected = selectGreeting(getCard(), greetingIndex)
    const rendered = renderCBS(selected.greeting, createCBSContext(new Map())).text

    if (activeAgent.getInput().length === 0 && rendered.length > 0)
      activeAgent.setInput([assistantMessage(rendered)])

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
    init: (nextAgent) => {
      agent = nextAgent
      card = normalizeCard(options.card)
      greetingIndex = selectGreeting(card, options.greetingIndex).index

      unsubscribe = nextAgent.subscribe('apeira', (event) => {
        if (event.type === 'turn.start') {
          activeTurnId = event.turnId
          turnPickCache.clear()
          instructionExtension = ''
        }
        else if (event.type === 'agent.cleared') {
          activeTurnId = undefined
          turnPickCache.clear()
          instructionExtension = ''
          restoreGreeting()
          emit({ greetingIndex, type: 'session.reset' })
        }
      })

      const hadContent = restoreGreeting()
      emit({ greetingIndex, hadContent, type: 'greeting.selected' })
    },
    name,
    prepareStep: (stepOptions) => {
      const context = createCBSContext()
      const definition = assembleCharacterDefinition(getCard(), context)
      const postHistoryInstructions = assemblePostHistoryInstructions(getCard(), context)
      const characterInput: ItemParam[] = definition.length > 0
        ? [systemMessage(definition)]
        : []
      const postHistoryInput: ItemParam[] = postHistoryInstructions.length > 0
        ? [systemMessage(postHistoryInstructions)]
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

      emit({
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
