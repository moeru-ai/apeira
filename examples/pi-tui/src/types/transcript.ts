export interface TranscriptEntry {
  id: string
  state?: 'error' | 'pending' | 'success'
  role: TranscriptRole
  text: string
  title?: string
}

export type TranscriptRole = 'assistant' | 'reasoning' | 'system' | 'tool' | 'user'
