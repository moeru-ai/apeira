import type { AgentEvent } from '@apeira/core'
import type { SlashCommand } from '@earendil-works/pi-tui'

import type { TranscriptEntry, TranscriptRole } from './types/transcript'

import process from 'node:process'

import c from 'tinyrainbow'

import { formatSkillInvocation } from '@apeira/plugin-skills'
import {
  CombinedAutocompleteProvider,
  Editor,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
} from '@earendil-works/pi-tui'

import { agent, skillsRegistry } from './utils/agent'
import { baseURL, model, workspaceRoot } from './utils/config'
import { skillsDir } from './utils/skills'

export const createPiTuiExampleApp = () => {
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal)
  const header = new Text('', 0, 0)
  const transcript = new Text('', 0, 0)
  const status = new Text('', 0, 0)
  const editor = new Editor(tui, {
    borderColor: c.cyan,
    selectList: {
      description: c.gray,
      noMatch: c.yellow,
      scrollInfo: c.gray,
      selectedPrefix: c.cyan,
      selectedText: c.bold,
    },
  })

  const entries: TranscriptEntry[] = []
  const assistantEntries = new Map<string, TranscriptEntry>()
  let pendingInputs = 0
  let runningTurnId: string | undefined
  let stopped = false

  const pushEntry = (role: TranscriptRole, text: string) => {
    const entry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
    }

    entries.push(entry)

    if (entries.length > 80)
      entries.splice(0, entries.length - 80)

    return entry
  }

  const pushSystem = (text: string) => {
    pushEntry('system', text)
  }

  const refreshSkills = async () => {
    await skillsRegistry.refresh()
    return skillsRegistry.getSkills()
  }

  const ensureAssistantEntry = (turnId: string) => {
    const existing = assistantEntries.get(turnId)
    if (existing != null)
      return existing

    const created = pushEntry('assistant', '')
    assistantEntries.set(turnId, created)
    return created
  }

  const renderEntry = (entry: TranscriptEntry) => {
    const label = {
      assistant: c.cyan('assistant'),
      system: c.gray('system'),
      tool: c.yellow('tool'),
      user: c.green('user'),
    }[entry.role]

    return `${label}\n${entry.text || c.dim('(streaming...)')}`
  }

  const render = () => {
    const currentStatus = runningTurnId == null
      ? c.green('idle')
      : c.yellow(`running ${runningTurnId.slice(0, 8)}`)

    header.setText([
      `${c.bold('Apeira Pi TUI')}  ${c.dim(`model=${model}`)}`,
      c.dim(`baseURL=${baseURL}`),
      c.dim(`cwd=${workspaceRoot}`),
    ].join('\n'))

    transcript.setText(
      entries.length === 0
        ? c.dim('No messages yet.')
        : entries.map(renderEntry).join('\n\n'),
    )

    status.setText(
      [
        `${c.bold('Status')} ${currentStatus}`,
        c.dim(`queued=${pendingInputs}`),
        c.dim('tools=list_files, read_file, write_file, edit_file, bash'),
        c.dim(`skills=${skillsRegistry.getSkills().length} dir=${skillsDir}`),
      ].join('  '),
    )

    tui.requestRender()
  }

  const onEvent = (event: AgentEvent) => {
    // eslint-disable-next-line ts/switch-exhaustiveness-check
    switch (event.type) {
      case 'text.delta':
        ensureAssistantEntry(event.turnId).text += event.delta
        break

      case 'text.done': {
        const entry = ensureAssistantEntry(event.turnId)
        if (event.text.length > 0)
          entry.text = event.text
        break
      }

      case 'tool-call.done':
        pushEntry('tool', `${event.toolCall.name}(${event.toolCall.arguments})`)
        break

      case 'tool-result.done':
        pushEntry(
          'tool',
          `tool result: ${event.toolResult.name}\n${typeof event.toolResult.output === 'string' ? event.toolResult.output : JSON.stringify(event.toolResult.output, null, 2)}`,
        )
        break

      case 'turn.aborted':
        if (runningTurnId === event.turnId)
          runningTurnId = undefined
        pendingInputs = 0
        assistantEntries.delete(event.turnId)
        pushSystem(`Turn ${event.turnId.slice(0, 8)} aborted.`)
        break

      case 'turn.done':
        if (runningTurnId === event.turnId)
          runningTurnId = undefined
        pendingInputs = 0
        assistantEntries.delete(event.turnId)
        break

      case 'turn.failed':
        if (runningTurnId === event.turnId)
          runningTurnId = undefined
        pendingInputs = 0
        assistantEntries.delete(event.turnId)
        pushSystem(`Turn failed: ${event.error instanceof Error ? event.error.message : String(event.error)}`)
        break

      case 'turn.input_drained':
        pendingInputs = Math.max(0, pendingInputs - event.count)
        break

      case 'turn.start':
        runningTurnId = event.turnId
        break
    }

    render()
  }

  const unsubscribe = agent.on(onEvent)

  const shutdown = (code: number) => {
    if (stopped)
      return

    stopped = true
    unsubscribe()
    tui.stop()
    queueMicrotask(() => process.exit(code))
  }

  const runCommand = async (commandLine: string) => {
    const [command, ...rest] = commandLine.slice(1).split(/\s+/)
    const argument = rest.join(' ').trim()

    switch (command) {
      case 'clear':
        agent.clear()
        entries.length = 0
        assistantEntries.clear()
        pendingInputs = 0
        runningTurnId = undefined
        pushSystem('Cleared transcript and in-memory thread state.')
        render()
        return

      case 'exit':
      case 'quit':
        shutdown(0)
        return

      case 'help':
        pushSystem([
          '/help: show commands',
          '/clear: reset transcript and Apeira thread state',
          '/skills: list loaded skills',
          '/skill <name> [instructions]: invoke a skill explicitly',
          '/exit: quit the demo',
          '/interrupt <message>: abort the current turn and replace it with a new user request',
        ].join('\n'))
        render()
        return

      case 'interrupt':
        if (argument.length === 0) {
          pushSystem('Usage: /interrupt <message>')
          render()
          return
        }

        pushEntry('user', argument)
        pendingInputs = 0
        runningTurnId = agent.interrupt({
          content: argument,
          role: 'user',
          type: 'message',
        }, 'user interrupted')
        render()
        return

      case 'skill': {
        if (argument.length === 0) {
          pushSystem('Usage: /skill <name> [instructions]')
          render()
          return
        }

        await refreshSkills()

        const [skillName, ...instructionParts] = argument.split(/\s+/)
        const skill = skillsRegistry.getSkill(skillName)
        if (skill == null) {
          pushSystem(`Unknown skill: ${skillName}`)
          render()
          return
        }

        const invocation = formatSkillInvocation(skill, instructionParts.join(' '))

        pushEntry('user', `/skill ${argument}`)

        const wasBusy = runningTurnId != null
        agent.send({
          content: invocation,
          role: 'user',
          type: 'message',
        })

        if (wasBusy)
          pendingInputs += 1

        render()
        return
      }

      case 'skills': {
        const loadedSkills = await refreshSkills()
        const diagnostics = skillsRegistry.getDiagnostics()

        pushSystem([
          loadedSkills.length === 0
            ? `No skills found in ${skillsDir}.`
            : loadedSkills.map(skill => `/${skill.name}: ${skill.description}`).join('\n'),
          diagnostics.length === 0
            ? ''
            : [
                '',
                'Warnings:',
                ...diagnostics.map(diagnostic => `${diagnostic.path ?? skillsDir}: ${diagnostic.message}`),
              ].join('\n'),
        ].filter(Boolean).join('\n'))
        render()
        return
      }

      default:
        pushSystem(`Unknown command: /${command}`)
        render()
    }
  }

  const onSubmit = (rawValue: string) => {
    const value = rawValue.trim()
    editor.setText('')

    if (value.length === 0) {
      render()
      return
    }

    if (value.startsWith('/')) {
      void runCommand(value)
      return
    }

    pushEntry('user', value)

    const wasBusy = runningTurnId != null
    agent.send({
      content: value,
      role: 'user',
      type: 'message',
    })

    if (wasBusy)
      pendingInputs += 1

    render()
  }

  editor.onSubmit = onSubmit

  const commands: SlashCommand[] = [
    { description: 'Show commands', name: 'help' },
    { description: 'Reset transcript and in-memory thread state', name: 'clear' },
    { description: 'List loaded skills', name: 'skills' },
    {
      argumentHint: '<name> [instructions]',
      description: 'Invoke a skill explicitly',
      getArgumentCompletions: async (prefix) => {
        const parts = prefix.trimStart().split(/\s+/)
        if (parts.length > 1)
          return null

        const loadedSkills = await refreshSkills()
        return loadedSkills
          .filter(skill => skill.name.startsWith(prefix.trim()))
          .map(skill => ({
            description: skill.description,
            label: skill.name,
            value: skill.name,
          }))
      },
      name: 'skill',
    },
    { argumentHint: '<message>', description: 'Abort the active turn and replace it', name: 'interrupt' },
    { description: 'Quit the demo', name: 'exit' },
    { description: 'Quit the demo', name: 'quit' },
  ]

  editor.setAutocompleteProvider?.(new CombinedAutocompleteProvider(commands, workspaceRoot))

  tui.addChild(header)
  tui.addChild(new Text('', 0, 0))
  tui.addChild(transcript)
  tui.addChild(new Text('', 0, 0))
  tui.addChild(status)
  tui.addChild(editor)
  tui.setFocus(editor)
  tui.addInputListener((data) => {
    if (matchesKey(data, 'ctrl+c')) {
      shutdown(0)
      return { consume: true }
    }

    if (matchesKey(data, 'escape') && runningTurnId != null) {
      agent.abort('user cancelled')
      pushSystem('Cancelled the active turn.')
      render()
      return { consume: true }
    }
  })

  void refreshSkills().then(() => render())
  pushSystem('Enter to send. Esc cancels the active turn. Commands: /help /skills /skill <name> /clear /exit /interrupt <message>.')
  render()

  return {
    start: () => {
      tui.start()
    },
  }
}
