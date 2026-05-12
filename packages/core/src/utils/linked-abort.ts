export const linkedAbort = (signal?: AbortSignal) => {
  const abort = new AbortController()

  if (!signal)
    return abort

  if (signal.aborted)
    abort.abort(signal.reason)
  else
    signal.addEventListener('abort', () => abort.abort(signal.reason), { once: true })

  return abort
}
