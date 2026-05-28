import type { TranscriptEntry, TranscriptRole } from '../types/transcript'

import { HITL_RESUME_PREFIX } from '../../../shared/hitl-demo'

export const HITL_TRANSCRIPT_LIMIT = 80

export const isHiddenHitlResumeInput = (content: string) =>
  content.startsWith(HITL_RESUME_PREFIX)

export const appendTranscriptEntry = (
  entries: TranscriptEntry[],
  role: TranscriptRole,
  text: string,
  options: Pick<TranscriptEntry, 'state' | 'title'> = {},
  createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
) => {
  const entry: TranscriptEntry = {
    id: createId(),
    role,
    text,
    ...options,
  }

  entries.push(entry)

  if (entries.length > HITL_TRANSCRIPT_LIMIT)
    entries.splice(0, entries.length - HITL_TRANSCRIPT_LIMIT)

  return entry
}
