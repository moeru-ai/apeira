export interface CBSContext {
  charName: string
  pickCache?: Map<string, string>
  random?: () => number
  userName?: string
}

export interface CBSResult {
  matchingText: string
  text: string
}

const splitChoices = (input: string): string[] => {
  const choices: string[] = []
  let current = ''

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '\\' && input[index + 1] === ',') {
      current += ','
      index++
    }
    else if (char === ',') {
      choices.push(current)
      current = ''
    }
    else {
      current += char
    }
  }

  choices.push(current)
  return choices
}

const choose = (choices: string[], random: () => number) =>
  choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] ?? ''

const normalizePickKey = (choices: string[]) =>
  choices.map(choice => choice.trim()).join(',')

const parseExpression = (
  raw: string,
  context: Required<Pick<CBSContext, 'charName' | 'pickCache' | 'random' | 'userName'>>,
): undefined | { matching: string, text: string } => {
  if (raw.trimStart().startsWith('//'))
    return { matching: '', text: '' }

  const separator = raw.indexOf(':')
  const rawName = separator === -1 ? raw : raw.slice(0, separator)
  const argument = separator === -1 ? '' : raw.slice(separator + 1)
  const name = rawName.trim().toLowerCase()

  switch (name) {
    case 'char':
      return { matching: context.charName, text: context.charName }
    case 'comment':
    case 'original':
      return { matching: '', text: '' }
    case 'hidden_key':
      return { matching: argument, text: '' }
    case 'pick': {
      const choices = splitChoices(argument)
      const key = normalizePickKey(choices)
      const selected = context.pickCache.get(key) ?? choose(choices, context.random)
      context.pickCache.set(key, selected)
      return { matching: selected, text: selected }
    }
    case 'random': {
      const selected = choose(splitChoices(argument), context.random)
      return { matching: selected, text: selected }
    }
    case 'reverse': {
      const reversed = [...argument].reverse().join('')
      return { matching: reversed, text: reversed }
    }
    case 'roll': {
      const sidesText = argument.trim().replace(/^d/i, '')
      if (!/^\d+$/.test(sidesText))
        return undefined
      const sides = Number.parseInt(sidesText, 10)
      if (!Number.isInteger(sides) || sides < 1)
        return undefined
      const rolled = String(Math.floor(context.random() * sides) + 1)
      return { matching: rolled, text: rolled }
    }
    case 'user':
      return { matching: context.userName, text: context.userName }
    default:
      return undefined
  }
}

export const renderCBS = (input: string, context: CBSContext): CBSResult => {
  const resolvedContext = {
    charName: context.charName,
    pickCache: context.pickCache ?? new Map<string, string>(),
    random: context.random ?? Math.random,
    userName: context.userName ?? 'User',
  }

  let matchingText = ''
  let text = ''
  let cursor = 0

  while (cursor < input.length) {
    const start = input.indexOf('{{', cursor)
    if (start === -1)
      break
    const end = input.indexOf('}}', start + 2)
    if (end === -1)
      break

    const whole = input.slice(start, end + 2)
    const expression = input.slice(start + 2, end)
    const literal = input.slice(cursor, start)
    const parsed = parseExpression(expression, resolvedContext)

    matchingText += literal + (parsed?.matching ?? whole)
    text += literal + (parsed?.text ?? whole)
    cursor = end + 2
  }

  matchingText += input.slice(cursor)
  text += input.slice(cursor)

  return { matchingText, text }
}
