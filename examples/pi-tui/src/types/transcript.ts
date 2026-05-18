export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  text: string
}

export type TranscriptRole = 'assistant' | 'system' | 'tool' | 'user'
