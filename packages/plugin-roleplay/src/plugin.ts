import type { Agent, AgentPlugin, AgentState, ItemParam } from '@apeira/core'
import type { CharacterCardV3 } from '@risuai/ccardlib'

import type { RoleplayEvent, RoleplayPluginOptions } from './types'
import type { CBSContext } from './utils/cbs'

import { name, version } from '../package.json'
import { renderCBS } from './utils/cbs'
import { selectGreeting } from './utils/greeting'
import { assistantMessage, systemMessage } from './utils/message'
import { normalizeCard } from './utils/normalize'
import {
  assembleCharacterDefinition,
  assembleInstructionExtension,
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
  ): CBSContext => {
    const userName = (state as { userName?: unknown }).userName
    return {
      charName: getCard().data.nickname ?? getCard().data.name,
      pickCache,
      userName: typeof userName === 'string' ? userName : undefined,
    }
  }

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
      const definition = assembleCharacterDefinition(getCard(), createCBSContext())
      const temporaryInput: ItemParam[] = definition.length > 0
        ? [systemMessage(definition)]
        : []
      const hasCharacterContext = instructionExtension.length > 0 || temporaryInput.length > 0

      emit({
        categories: hasCharacterContext ? ['character'] : [],
        instructionExtension,
        temporaryInput,
        turnId: activeTurnId,
        type: 'prompt.assembled',
      })

      return temporaryInput.length > 0
        ? { input: [...temporaryInput, ...stepOptions.input] }
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
