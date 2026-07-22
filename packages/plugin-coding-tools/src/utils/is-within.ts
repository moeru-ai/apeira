import { isAbsolute, relative } from 'node:path'

export const isWithin = (candidate: string, root: string) => {
  if (!isAbsolute(candidate) || !isAbsolute(root))
    return false
  const nested = relative(root, candidate)
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}
