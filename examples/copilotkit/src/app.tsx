import { ChatPanel } from './components/chat-panel'
import { ThreadSidebar } from './components/thread-sidebar'
import { useThreads } from './hooks/use-threads'

import '@copilotkit/react-ui/v2/styles.css'

export const App = () => {
  const {
    activeThreadId,
    archiveThread,
    createThread,
    renameThread,
    selectThread,
    threads,
    touchThread,
  } = useThreads()

  if (activeThreadId == null)
    return null

  return (
    <div className="h-screen flex">
      <aside className="w-72 overflow-y-auto border-r">
        <ThreadSidebar
          activeThreadId={activeThreadId}
          onArchiveThread={archiveThread}
          onCreateThread={createThread}
          onRenameThread={renameThread}
          onSelectThread={selectThread}
          threads={threads}
        />
      </aside>
      <main className="flex-1">
        <ChatPanel
          onThreadUpdated={touchThread}
          threadId={activeThreadId}
        />
      </main>
    </div>
  )
}
