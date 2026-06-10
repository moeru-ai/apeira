# @apeira/plugin-skills

A skill system for Apeira with multi-source support. Skills are named instruction sets that the model can load on demand via a `skill` tool.

## Install

```sh
pnpm add @apeira/plugin-skills
```

## Usage

### Filesystem skill set (built-in, Node.js only)

```ts
import { createAgent, responses } from '@apeira/core'
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

const skills = fsSkillSet({ directory: '.agents/skills' })

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  plugins: [skills({ sets: [skills] })],
})
```

### Multiple skill sets with priority

```ts
const localSkills = fsSkillSet({ directory: '.agents/skills', priority: 0 })

const customSkills = createSkillSet({
  skills: [{
    content: '# Math\nUse proper notation and show steps.',
    description: 'Expert math problem solving.',
    filePath: '.agents/skills/math/SKILL.md',
    name: 'math',
  }],
})

const agent = createAgent({
  plugins: [
    skills({
      sets: [localSkills, customSkills],
    }),
  ],
})
```

## API

### `skills(options?)`

Creates an Apeira plugin that:

- Injects available skill metadata into the system prompt via `extendInstructions`
- Provides a `skill` tool for the model to load skill content
- Optionally provides a `skill_reference` tool for reference files
- Supports `refresh: 'turn'` to reload skills before each turn

### `createSkillSet(options?)`

Creates a skill set backed by inline skills or custom loader functions.

### `fsSkillSet(options)` (`@apeira/plugin-skills/fs`)

Creates a skill set that reads skills from a filesystem directory. Each skill is expected to be in a subdirectory: `<directory>/<skill-name>/SKILL.md` with optional YAML frontmatter (`name`, `description`) and an optional `references/` subdirectory.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `directory` | `string` | — | Base directory containing skill subdirectories |
| `allowedReferenceExtensions` | `string[]` | `['.md', '.mdx', '.txt']` | Allowed reference file extensions |
| `priority` | `number` | — | Priority for deduplication when merged with other sets |

### Composite via `sets` option

When you pass multiple `SkillSet` instances via the `sets` option, skills are merged automatically. Higher `priority` wins dedup; if equal, earlier in the array wins.

### `Skill`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique skill identifier |
| `description` | `string` | Shown to the model for skill selection |
| `content` | `string` | Full instruction content |
| `filePath` | `string` | Source location (for reference resolution) |
| `references?` | `SkillReference[]` | Reference file manifests |

### `SkillsPluginOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sets` | `SkillSet[]` | — | Skill sets to merge |
| `refresh` | `'manual' \| 'turn'` | `'turn'` when `sets` is provided, else `'manual'` | When to reload skills |
| `toolName` | `string` | `'skill'` | Name for the skill tool |
| `referenceToolName` | `string` | `'skill_reference'` | Name for the reference tool |

## Features

- **Multiple skill sets** — combine filesystem, inline, remote, or custom sets
- **Built-in FS skill set** — reads skills from `<dir>/<name>/SKILL.md` with YAML frontmatter
- **Model invocation** — the model chooses when to load a skill via the `skill` tool
- **Reference system** — skills can reference external files loaded lazily
- **Refresh modes** — `manual` or `turn` (reload before each turn)
- **Decoupled I/O** — core package has no Node.js deps; FS support is a subpath import
