import type { RoleplayEvent } from './types'

export { roleplay } from './plugin'
export type {
  RoleplayEvent,
  RoleplayPluginOptions,
  RoleplayPromptCategory,
  SupportedCharacterCard,
} from './types'

declare module '@apeira/core' {
  interface AgentCustomEvent {
    roleplay: RoleplayEvent
  }

  interface AgentCustomState {
    userName?: string
  }
}
