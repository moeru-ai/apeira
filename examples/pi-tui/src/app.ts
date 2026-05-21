import type { AgentEvent } from '@apeira/core'
import type { MarkdownTheme, SlashCommand } from '@earendil-works/pi-tui'

import type { TranscriptEntry, TranscriptRole } from './types/transcript'

import process from 'node:process'

import c from 'tinyrainbow'

import { formatSkillInvocation } from '@apeira/plugin-skills'
import { Box, CombinedAutocompleteProvider, Container, Editor, Markdown, matchesKey, ProcessTerminal, Spacer, Text, TUI } from '@earendil-works/pi-tui'

import { agent, skillSet, skillsDir } from './utils/agent'
import { model, workspaceRoot } from './utils/config'

type ReasoningMode = 'compact' | 'full'

const markdownTheme: MarkdownTheme = {
  bold: c.bold,
  code: c.yellow,
  codeBlock: c.yellow,
  codeBlockBorder: c.gray,
  heading: c.cyan,
  hr: c.gray,
  italic: c.italic,
  link: c.cyan,
  linkUrl: c.gray,
  listBullet: c.cyan,
  quote: c.gray,
  quoteBorder: c.gray,
  strikethrough: c.strikethrough,
  underline: c.underline,
}

const parseToolArguments = (value: string): unknown => {
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null

const stringArg = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const numberArg = (value: unknown) =>
  typeof value === 'number' ? value : undefined

const booleanArg = (value: unknown) =>
  typeof value === 'boolean' ? value : undefined

const compactSingleLine = (text: string, maxChars = 120) => {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > maxChars ? `${singleLine.slice(0, maxChars - 1)}…` : singleLine
}

const formatEditDiff = (args: unknown) => {
  if (!isRecord(args))
    return ''

  const oldString = stringArg(args.oldString)
  const newString = stringArg(args.newString)
  const targetPath = stringArg(args.targetPath, 'file')
  if (oldString.length === 0 && newString.length === 0)
    return ''

  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  const maxChangedLines = 80
  const changedLines = oldLines.length + newLines.length
  const trimmed = changedLines > maxChangedLines
  const shownOldLines = trimmed ? oldLines.slice(0, Math.floor(maxChangedLines / 2)) : oldLines
  const shownNewLines = trimmed ? newLines.slice(0, Math.floor(maxChangedLines / 2)) : newLines

  return [
    c.gray(`--- ${targetPath}`),
    c.gray(`+++ ${targetPath}`),
    ...shownOldLines.map(line => c.red(`- ${line}`)),
    ...shownNewLines.map(line => c.green(`+ ${line}`)),
    trimmed ? c.gray(`... diff truncated (${changedLines.toLocaleString()} changed lines)`) : '',
  ].filter(Boolean).join('\n')
}

const formatToolCallSummary = (name: string, args: unknown) => {
  if (!isRecord(args))
    return compactSingleLine(String(args))

  switch (name) {
    case 'bash':
      return `$ ${compactSingleLine(stringArg(args.command), 180)}`
    case 'edit_file':
      return [
        stringArg(args.targetPath, 'file'),
        booleanArg(args.replaceAll) ? 'replace all' : 'replace one',
      ].join('  ')
    case 'list_files':
      return [
        stringArg(args.targetPath, '.'),
        booleanArg(args.recursive) ? 'recursive' : '',
      ].filter(Boolean).join('  ')
    case 'read_file': {
      const startLine = numberArg(args.startLine)
      const endLine = numberArg(args.endLine)
      const range = startLine != null || endLine != null ? `:${startLine ?? 1}-${endLine ?? '?'}` : ''
      return `${stringArg(args.targetPath, 'file')}${range}`
    }
    case 'write_file':
      return stringArg(args.targetPath, 'file')
    default:
      return compactSingleLine(JSON.stringify(args))
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
const formatToolResultSummary = (name: string, args: unknown, output: unknown) => {
  const result = isRecord(output) ? output : {}
  const status = stringArg(result.status, 'done')

  switch (name) {
    case 'bash': {
      const exitCode = numberArg(result.exitCode)
      const timedOut = booleanArg(result.timedOut)
      return [
        formatToolCallSummary(name, args),
        c.gray(timedOut ? 'timed out' : `exit ${exitCode ?? '?'}`),
      ].join('\n')
    }
    case 'edit_file': {
      const replacements = numberArg(result.replacements)
      return [
        `${stringArg(result.path, stringArg(isRecord(args) ? args.targetPath : undefined, 'file'))}  ${status}${replacements != null ? ` (${replacements} replacement${replacements === 1 ? '' : 's'})` : ''}`,
        formatEditDiff(args),
      ].filter(Boolean).join('\n\n')
    }
    case 'list_files': {
      const entries = Array.isArray(result.entries) ? result.entries.length : undefined
      return `${stringArg(result.root, stringArg(isRecord(args) ? args.targetPath : undefined, '.'))}  ${entries ?? '?'} entries${booleanArg(result.truncated) ? '  truncated' : ''}`
    }
    case 'read_file':
      return `${stringArg(result.path, stringArg(isRecord(args) ? args.targetPath : undefined, 'file'))}  lines ${numberArg(result.startLine) ?? '?'}-${numberArg(result.endLine) ?? '?'}`
    case 'write_file':
      return `${stringArg(result.path, stringArg(isRecord(args) ? args.targetPath : undefined, 'file'))}  ${numberArg(result.bytes) ?? '?'} bytes written`
    default:
      return formatToolCallSummary(name, args)
  }
}

const splitFirstLine = (text: string) => {
  const lines = text.trim().split('\n')
  return {
    firstLine: lines[0] ?? '',
    rest: lines.slice(1).join('\n').trim(),
  }
}

const formatToolDisplay = (entry: TranscriptEntry) => {
  const title = entry.title ?? 'tool'
  const { firstLine, rest } = splitFirstLine(entry.text)
  const stateSuffix = entry.state === 'pending'
    ? c.gray(' (running)')
    : entry.state === 'error'
      ? c.red(' (error)')
      : ''

  const verb = {
    bash: 'Ran',
    edit_file: 'Edited',
    list_files: 'Listed',
    read_file: 'Read',
    write_file: 'Wrote',
  }[title] ?? `Used ${title}`

  const displayTarget = title === 'bash' && firstLine.startsWith('$ ')
    ? firstLine.slice(2)
    : firstLine

  const lines = [`${c.green('•')} ${c.bold(verb)} ${c.cyan(displayTarget)}${stateSuffix}`]
  if (rest.length > 0) {
    lines.push(...rest.split('\n').map(line => `  ${line}`))
  }

  return lines.join('\n')
}

const compactReasoningText = (text: string) => {
  const maxChars = 6000
  if (text.length <= maxChars)
    return text

  const headChars = 1800
  const tailChars = 3600
  const omitted = text.length - headChars - tailChars

  return [
    text.slice(0, headChars).trimEnd(),
    c.dim(`\n\n... ${omitted.toLocaleString()} chars hidden; showing the latest reasoning. Use /reasoning full to expand. ...\n`),
    text.slice(-tailChars).trimStart(),
  ].join('')
}

const shortTurnId = (turnId: string) => turnId.slice(0, 8)

export const createPiTuiExampleApp = () => {
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal)
  const header = new Text('', 0, 0)
  const transcript = new Container()
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
  const reasoningEntries = new Map<string, TranscriptEntry>()
  const toolEntries = new Map<string, TranscriptEntry>()
  const toolArguments = new Map<string, unknown>()
  let pendingInputs = 0
  let reasoningMode: ReasoningMode = 'compact'
  let runningTurnId: string | undefined
  let stopped = false

  const pushEntry = (role: TranscriptRole, text: string, options: Pick<TranscriptEntry, 'state' | 'title'> = {}) => {
    const entry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      ...options,
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
    await skillSet.refresh()
    return skillSet.getSkills()
  }

  const ensureAssistantEntry = (turnId: string) => {
    const existing = assistantEntries.get(turnId)
    if (existing != null)
      return existing

    const created = pushEntry('assistant', '')
    assistantEntries.set(turnId, created)
    return created
  }

  const ensureReasoningEntry = (turnId: string) => {
    const existing = reasoningEntries.get(turnId)
    if (existing != null)
      return existing

    const created = pushEntry('reasoning', '', { title: `reasoning ${shortTurnId(turnId)}` })
    reasoningEntries.set(turnId, created)
    return created
  }

  const renderEntry = (entry: TranscriptEntry) => {
    switch (entry.role) {
      case 'assistant':
        if (entry.text.trim().length === 0)
          return new Text(c.dim('(assistant streaming...)'), 1, 0)

        return new Markdown(entry.text.trim(), 1, 0, markdownTheme)

      case 'reasoning': {
        const body = entry.text.trim().length === 0
          ? c.dim('(reasoning...)')
          : reasoningMode === 'full'
            ? entry.text.trim()
            : compactReasoningText(entry.text.trim())

        return new Markdown(body, 1, 0, markdownTheme, {
          color: c.dim,
          italic: true,
        })
      }

      case 'system':
        return new Text(c.gray(entry.text), 1, 0)

      case 'tool': {
        return new Text(formatToolDisplay(entry), 1, 0)
      }

      case 'user': {
        const box = new Box(2, 1, c.bgWhite)
        box.addChild(new Markdown(entry.text, 0, 0, markdownTheme, {
          color: c.black,
        }))
        return box
      }
    }
  }

  const render = () => {
    const currentStatus = runningTurnId == null
      ? c.green('idle')
      : c.yellow(`running ${runningTurnId.slice(0, 8)}`)

    header.setText([
      `${c.bold('Apeira')} ${c.dim('pi-tui example')}`,
    ].join('\n'))

    transcript.clear()
    if (entries.length === 0) {
      transcript.addChild(new Text(c.dim('No messages yet.'), 1, 0))
    }
    else {
      for (const entry of entries) {
        transcript.addChild(new Spacer(1))
        transcript.addChild(renderEntry(entry))
      }
    }

    status.setText(
      [
        `${c.bold('Status')} ${currentStatus}`,
        c.dim(`queued=${pendingInputs}`),
        c.dim(`cwd=${workspaceRoot}`),
        c.dim(`model=${model}`),
      ].join('  '),
    )

    tui.requestRender()
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onEvent = (event: AgentEvent) => {
    // eslint-disable-next-line ts/switch-exhaustiveness-check
    switch (event.type) {
      case 'reasoning.delta':
        ensureReasoningEntry(event.turnId).text += event.delta
        break

      case 'reasoning.done': {
        const entry = ensureReasoningEntry(event.turnId)
        if (event.text.length > 0)
          entry.text = event.text
        break
      }

      case 'reasoning.start':
        ensureReasoningEntry(event.turnId)
        break

      case 'text.delta':
        ensureAssistantEntry(event.turnId).text += event.delta
        break

      case 'text.done': {
        const entry = ensureAssistantEntry(event.turnId)
        if (event.text.length > 0)
          entry.text = event.text
        break
      }

      case 'text.start':
        ensureAssistantEntry(event.turnId)
        break

      case 'tool-call.done': {
        const args = parseToolArguments(event.toolCall.arguments)
        const entry = pushEntry('tool', formatToolCallSummary(event.toolCall.name, args), {
          state: 'pending',
          title: event.toolCall.name,
        })
        toolEntries.set(event.toolCall.id, entry)
        toolArguments.set(event.toolCall.id, args)
        break
      }

      case 'tool-result.done': {
        const existing = toolEntries.get(event.toolResult.id)
        const args = toolArguments.get(event.toolResult.id)
        if (existing != null) {
          existing.state = 'success'
          existing.title = event.toolResult.name
          existing.text = formatToolResultSummary(event.toolResult.name, args, event.toolResult.output)
        }
        else {
          pushEntry(
            'tool',
            formatToolResultSummary(event.toolResult.name, undefined, event.toolResult.output),
            {
              state: 'success',
              title: event.toolResult.name,
            },
          )
        }
        break
      }

      case 'turn.aborted':
        if (runningTurnId === event.turnId)
          runningTurnId = undefined
        pendingInputs = 0
        assistantEntries.delete(event.turnId)
        reasoningEntries.delete(event.turnId)
        pushSystem(`Turn ${event.turnId.slice(0, 8)} aborted.`)
        break

      case 'turn.done':
        if (runningTurnId === event.turnId)
          runningTurnId = undefined
        pendingInputs = 0
        assistantEntries.delete(event.turnId)
        reasoningEntries.delete(event.turnId)
        break

      case 'turn.failed':
        if (runningTurnId === event.turnId)
          runningTurnId = undefined
        pendingInputs = 0
        assistantEntries.delete(event.turnId)
        reasoningEntries.delete(event.turnId)
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const runCommand = async (commandLine: string) => {
    const [command, ...rest] = commandLine.slice(1).split(/\s+/)
    const argument = rest.join(' ').trim()

    switch (command) {
      case 'clear':
        agent.clear()
        entries.length = 0
        assistantEntries.clear()
        reasoningEntries.clear()
        toolEntries.clear()
        toolArguments.clear()
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
          '/reasoning compact|full: switch reasoning display length',
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
        agent.abort('user interrupted')
        runningTurnId = agent.send({
          content: argument,
          role: 'user',
          type: 'message',
        })
        render()
        return

      case 'reasoning':
        if (argument !== 'compact' && argument !== 'full') {
          pushSystem(`Reasoning display is ${reasoningMode}. Usage: /reasoning compact|full`)
          render()
          return
        }

        reasoningMode = argument
        pushSystem(`Reasoning display set to ${reasoningMode}.`)
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
        const skill = skillSet.getSkill(skillName)
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
        const diagnostics = skillSet.getDiagnostics()

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
    { argumentHint: 'compact|full', description: 'Switch reasoning display length', name: 'reasoning' },
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
  tui.addChild(editor)
  tui.addChild(status)
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
  pushSystem('Enter to send. Esc cancels the active turn. Commands: /help /skills /skill <name> /reasoning compact|full /clear /exit /interrupt <message>.')
  render()

  return {
    start: () => {
      tui.start()
    },
  }
}
