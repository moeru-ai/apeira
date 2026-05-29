export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  state?: 'approval' | 'error' | 'running' | 'success'
  text: string
  title?: string
}

export type TranscriptRole = 'assistant' | 'reasoning' | 'system' | 'tool' | 'user'
