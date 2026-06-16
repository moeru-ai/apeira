export interface FileStorageOptions<T> {
  initial?: readonly T[]
  /** Path to the file. */
  path: string
}
