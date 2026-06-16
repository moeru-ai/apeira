export interface FileStoreOptions<T> {
  initial?: readonly T[]
  /** Path to the file. */
  path: string
}
