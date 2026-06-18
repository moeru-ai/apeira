import { SessionError } from './types'

const hasForbiddenCharacter = (name: string) =>
  [...name].some(character =>
    character.charCodeAt(0) < 32
    || ' ~^:?*[\\'.includes(character),
  )

export const validateRef = (name: string) => {
  const invalid
    = name.length === 0
      || name === '@'
      || name === 'HEAD'
      || name.startsWith('.')
      || name.endsWith('.')
      || name.endsWith('/')
      || name.endsWith('.lock')
      || name.includes('..')
      || name.includes('//')
      || name.includes('/.')
      || name.includes('@{')
      || hasForbiddenCharacter(name)

  if (!invalid)
    return

  throw new SessionError('invalid_ref', `Invalid session ref: ${name}`)
}
