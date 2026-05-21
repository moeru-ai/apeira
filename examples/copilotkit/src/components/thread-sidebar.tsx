import type { LocalThread } from '../hooks/use-threads'

import { ThreadRow } from './thread-row'

interface ThreadSidebarProps {
  activeThreadId: string
  onArchiveThread: (threadId: string) => void
  onCreateThread: () => void
  onRenameThread: (threadId: string, name: string) => void
  onSelectThread: (threadId: string) => void
  threads: LocalThread[]
}

export const ThreadSidebar = ({
  activeThreadId,
  onArchiveThread,
  onCreateThread,
  onRenameThread,
  onSelectThread,
  threads,
}: ThreadSidebarProps) => {
  return (
    <div className="h-full flex flex-col">
      <button
        className="m-3 rounded bg-blue-600 p-2 text-sm text-white"
        onClick={onCreateThread}
      >
        New conversation
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.map(thread => (
          <ThreadRow
            active={thread.id === activeThreadId}
            key={thread.id}
            onArchive={() => onArchiveThread(thread.id)}
            onRename={name => onRenameThread(thread.id, name)}
            onSelect={() => onSelectThread(thread.id)}
            thread={thread}
          />
        ))}
      </div>
    </div>
  )
}
