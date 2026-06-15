export const createKeyedQueue = <K>() => {
  const operations = new Map<K, Promise<void>>()

  return async <T>(key: K, operation: () => Promise<T>): Promise<T> => {
    const result = (operations.get(key) ?? Promise.resolve()).then(operation, operation)
    const ready = result.then(() => {}, () => {})
    operations.set(key, ready)
    void ready.finally(() => {
      if (operations.get(key) !== ready)
        return

      operations.delete(key)
    })
    return result
  }
}
