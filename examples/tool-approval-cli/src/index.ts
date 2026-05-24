import type { ScenarioName } from './scenarios'

import process from 'node:process'

import { runScenarioWithTurns } from './agent'
import { createInteractiveChoiceProvider } from './approval-prompt'
import { getScenario, scenarioNames } from './scenarios'

const formatInput = (input: unknown) =>
  JSON.stringify(input)

const main = async () => {
  const scenario = (process.argv[2] ?? 'conversation') as ScenarioName
  if (!scenarioNames.includes(scenario)) {
    process.stderr.write(`Unknown scenario "${scenario}". Available: ${scenarioNames.join(', ')}\n`)
    process.exitCode = 1
    return
  }

  const selected = getScenario(scenario)

  const choiceProvider = createInteractiveChoiceProvider()
  try {
    process.stdout.write(`Scenario: ${scenario}\n`)
    const result = await runScenarioWithTurns({
      choiceProvider,
      modeSwitchAfterTurn: selected.modeSwitchAfterTurn,
      reporter: {
        onAssistantMessage: (text) => {
          process.stdout.write(`\nAgent\n  ${text}\n`)
        },
        onDecision: (event) => {
          process.stdout.write(`\nDecision event\n  ${event.decision.type} from ${event.source} (${event.request.toolName})\n`)
        },
        onModeSwitch: (mode) => {
          process.stdout.write(`\nRuntime policy\n  mode switched to ${mode}\n`)
        },
        onToolActivity: (execution) => {
          process.stdout.write(`\nTool activity\n  ${execution.toolName} success ${formatInput(execution.input)}\n`)
        },
        onUserMessage: (text) => {
          process.stdout.write(`\nUser\n  ${text}\n`)
        },
      },
      turns: selected.turns,
    })

    process.stdout.write('\nSummary\n')
    process.stdout.write(`Approval prompts: ${result.approvalPrompts.length}\n`)
    process.stdout.write(`Tool executions: ${result.toolExecutions.length}\n`)
    process.stdout.write(`Decision events: ${result.approvalEvents.map(event => event.source).join(', ')}\n`)
  }
  finally {
    choiceProvider.close()
  }
}

// eslint-disable-next-line @masknet/no-top-level
void main()
