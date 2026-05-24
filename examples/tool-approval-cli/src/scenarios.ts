import type { ApprovalChoice, ApprovalChoiceProvider } from './approval-prompt'
import type { FakeModelTurn } from './fake-model'

import { runScenarioWithTurns } from './agent'

export interface RunScenarioOptions {
  choices?: ApprovalChoice[]
  scenario: ScenarioName
}

export type ScenarioName
  = | 'approval-key'
    | 'conversation'
    | 'deny'
    | 'once'
    | 'runtime-policy-switch'
    | 'turn'

const commandCall = (command: string) => ({
  input: { command },
  toolName: 'runCommand',
})

const SCENARIOS: Record<ScenarioName, { modeSwitchAfterTurn?: number, turns: FakeModelTurn[] }> = {
  'approval-key': {
    turns: [
      { calls: [commandCall('git status')], prompt: 'Run a safe command.' },
      { calls: [commandCall('rm -rf .')], prompt: 'Run a dangerous command.' },
    ],
  },
  'conversation': {
    turns: [
      { calls: [commandCall('git status')], prompt: 'Run command once.' },
      { calls: [commandCall('git status')], prompt: 'Run command again.' },
    ],
  },
  'deny': {
    turns: [
      { calls: [commandCall('rm -rf .')], prompt: 'Run dangerous command.' },
    ],
  },
  'once': {
    turns: [
      { calls: [commandCall('git status')], prompt: 'Run command once.' },
      { calls: [commandCall('git status')], prompt: 'Run command again.' },
    ],
  },
  'runtime-policy-switch': {
    modeSwitchAfterTurn: 0,
    turns: [
      { calls: [commandCall('git status')], prompt: 'Allow command for conversation.' },
      { calls: [commandCall('git status')], prompt: 'Run command after policy switch.' },
    ],
  },
  'turn': {
    turns: [
      {
        calls: [
          commandCall('git status'),
          commandCall('git status'),
        ],
        prompt: 'Run command twice in one turn.',
      },
      { calls: [commandCall('git status')], prompt: 'Run command in the next turn.' },
    ],
  },
}

const createChoiceProvider = (choices: ApprovalChoice[]): ApprovalChoiceProvider => {
  let index = 0

  return () => {
    const choice = choices[index] ?? choices.at(-1) ?? 'deny'
    index += 1
    return choice
  }
}

export const getScenario = (scenario: ScenarioName) => SCENARIOS[scenario]

export const runScenario = async (options: RunScenarioOptions) => {
  const scenario = getScenario(options.scenario)

  return runScenarioWithTurns({
    choiceProvider: createChoiceProvider(options.choices ?? ['deny']),
    modeSwitchAfterTurn: scenario.modeSwitchAfterTurn,
    turns: scenario.turns,
  })
}

export const scenarioNames = Object.keys(SCENARIOS) as ScenarioName[]
