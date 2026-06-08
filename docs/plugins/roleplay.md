# Roleplay

`@apeira/plugin-roleplay` adds text-only, single-character roleplay driven by
Character Card V1, V2, or V3 objects.

## Install

```sh
pnpm add @apeira/plugin-roleplay
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { roleplay } from '@apeira/plugin-roleplay'

const agent = createAgent({
  instructions: '',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [roleplay({ card, greetingIndex: 0 })],
  state: { userName: 'Alice' },
})
```

The caller must parse the card file before passing it to the plugin. Empty base
instructions are required for Character Card compatible prompt ordering.

## P1 Behavior

- Converts V1 and V2 cards to CCv3 and accepts supported V3 cards.
- Adds the selected greeting to empty conversation history.
- Renders `system_prompt`, `mes_example`, and the character definition with CCv3 CBS.
- Injects the character definition temporarily, without persisting it.
- Rerenders the greeting when `agent.clear()` resets the conversation.
- Emits typed events on the `roleplay` channel for debugging.

The plugin runs with `enforce: 'post'`, after history-rewriting plugins such as
Compact.

Lorebooks and decorators are deferred to P2. Group chat and
`group_only_greetings` are deferred to P3.
