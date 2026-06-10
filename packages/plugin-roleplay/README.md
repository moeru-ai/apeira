# @apeira/plugin-roleplay

Character Card based roleplay for Apeira agents.

Supports text-only, single-character Character Card V1, V2, and V3 cards,
including greetings, character prompts, example dialogue, and CCv3 character
book substitutions.

## Install

```sh
pnpm add @apeira/plugin-roleplay
```

## Usage

```ts
import { createAgent, responses } from '@apeira/core'
import { roleplay } from '@apeira/plugin-roleplay'

const agent = createAgent({
  instructions: '',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  plugins: [
    roleplay({
      card,
      greetingIndex: 0,
    }),
  ],
  state: {
    userName: 'Alice',
  },
})
```

Pass an already-parsed character card object. Loading cards from PNG, JSON, or
CHARX files is left to the application.

Use empty agent instructions to preserve the prompt behavior defined by the
character card.

## API

### `roleplay(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `card` | `CharacterCardV1 \| CharacterCardV2 \| CharacterCardV3` | — | Parsed character card |
| `greetingIndex` | `number` | `0` | `0` selects `first_mes`; positive values select `alternate_greetings[index - 1]` |

Invalid greeting indices fall back to `first_mes`. The greeting is added only
when starting with empty conversation history and is restored after
`agent.clear()`.

Set `state.userName` to control `{{user}}`. It defaults to `User`.

## Limitations

- Text only
- Single character
- Character lorebooks and decorators are not supported yet
- RisuAI-specific scripts and extension behavior are not supported
