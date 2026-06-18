export const createMutationQueue = () => {
  let ready = Promise.resolve()

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = ready.then(operation, operation)
    ready = result.then(() => undefined, () => undefined)
    return result
  }
}
