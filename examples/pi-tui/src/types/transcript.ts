export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  state?: 'error' | 'pending' | 'success'
  text: string
  title?: string
}

export type TranscriptRole = 'assistant' | 'reasoning' | 'system' | 'tool' | 'user'
