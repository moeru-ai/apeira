export const raceAbort = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  signal.throwIfAborted()
  let onAbort = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`

  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')
    return `{${entries}}`
  }

  return JSON.stringify(value) ?? String(value)
}
