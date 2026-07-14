---
layout: home

hero:
  # name: Apeira
  text: stream-first Agent Runtime.
  ## tagline:
  actions:
    - theme: brand
      text: Get Started
      link: /overview
    - theme: alt
      text: View on GitHub
      link: https://github.com/moeru-ai/apeira

terminal:
  tabs:
    - id: run
      label: run
      language: typescript
      code: |
        import { createAgent, responses, run, user } from 'apeira'

        const agent = createAgent({
          instructions: 'You are a concise assistant.',
          runner: responses({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: 'https://api.openai.com/v1/',
            model: 'gpt-5.5',
          }),
        })

        for await (const event of run(agent, user('Say hello.')))
          console.log(event.turnId, event.type)
    - id: subscribe
      label: subscribe
      language: typescript
      code: |
        import { createAgent, responses, user } from 'apeira'

        const agent = createAgent({
          instructions: 'You are a concise assistant.',
          runner: responses({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: 'https://api.openai.com/v1/',
            model: 'gpt-5.5',
          }),
        })

        agent.subscribe('apeira', event =>
          console.log(event.turnId, event.type)
        )

        agent.send(user('Say hello.'))
    - id: tools
      label: tools
      language: typescript
      code: |
        import { createAgent, responses, run, tool, user } from 'apeira'
        import { z } from 'zod'

        const agent = createAgent({
          instructions: 'You are a concise assistant.',
          runner: responses({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: 'https://api.openai.com/v1/',
            model: 'gpt-5.5',
          }),
          tools: [
            tool({
              description: 'Greets a person by name.',
              execute: ({ name }) => `Hello, ${name}!`,
              name: 'greet',
              parameters: z.object({
                name: z.string().describe('The person to greet.'),
              }),
            }),
          ],
        })

features:
  - title: Stream-first
    details: Submit a turn and consume its lifecycle and model events as a ReadableStream.
  - title: Plugin-first
    details: Only install what you need. Plugins, runners, and storage adapters keep optional capabilities outside the core runtime.
  - title: xsAI-based
    details: Model calls, tools, steps, and streaming events are powered by xsAI and work with any OpenAI-compatible endpoint.
  - title: Append-only history
    details: Every turn forks the input log, runs on a working copy, and merges only successful episodes back.
  - title: Session branches
    details: Optional tree-shaped durable history with checkout, fork, and rebase via @apeira/session.
  - title: Interrupt
    details: Cancel individual turns, interrupt active work while preserving context, or reset the agent to a clean baseline.
---

<Home />
