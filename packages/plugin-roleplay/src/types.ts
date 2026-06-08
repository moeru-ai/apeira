import type { ItemParam } from '@apeira/core'
import type {
  CharacterCardV1,
  CharacterCardV2,
  CharacterCardV3,
} from '@risuai/ccardlib'

export type RoleplayEvent
  = | {
    categories: RoleplayPromptCategory[]
    instructionExtension: string
    temporaryInput: ItemParam[]
    turnId?: string
    type: 'prompt.assembled'
  }
  | {
    greetingIndex: number
    hadContent: boolean
    type: 'greeting.selected'
  }
  | {
    greetingIndex: number
    type: 'session.reset'
  }

export interface RoleplayPluginOptions {
  /** Already-parsed character card object. */
  card: SupportedCharacterCard
  /** 0 = first_mes, 1+ = alternate_greetings[index - 1]. Default: 0. */
  greetingIndex?: number
}

export type RoleplayPromptCategory
  = | 'character'
    | 'lorebook'
    | 'post_history_instructions'

export type SupportedCharacterCard
  = | CharacterCardV1
    | CharacterCardV2
    | CharacterCardV3
