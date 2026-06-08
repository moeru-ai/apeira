import type {
  CharacterCardV3,
} from '@risuai/ccardlib'

import type { SupportedCharacterCard } from '../types'

import { CCardLib } from '@risuai/ccardlib'

export const normalizeCard = (input: SupportedCharacterCard): CharacterCardV3 => {
  const version = CCardLib.character.check(input)

  switch (version) {
    case 'v1':
    case 'v2':
      return CCardLib.character.convert(input, {
        from: version,
        options: { convertRisuFields: false },
        to: 'v3',
      })
    case 'v3':
      return input as CharacterCardV3
    case 'unknown':
      throw new TypeError('[@apeira/plugin-roleplay] Unsupported character card.')
  }
}
