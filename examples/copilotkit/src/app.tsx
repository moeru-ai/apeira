import { ChatPanel } from './components/chat-panel'
import { ThreadSidebar } from './components/thread-sidebar'
import { SidebarProvider, SidebarTrigger } from './components/ui/sidebar'
import { useThreads } from './hooks/use-threads'

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
    <SidebarProvider>
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onArchiveThread={archiveThread}
        onCreateThread={createThread}
        onRenameThread={renameThread}
        onSelectThread={selectThread}
        threads={threads}
      />
      <main className="relative h-screen max-h-screen w-full">
        <SidebarTrigger className="absolute left-0 top-0 z-10 m-2" />
        <ChatPanel
          className="h-full w-full"
          key={activeThreadId}
          onThreadUpdated={touchThread}
          threadId={activeThreadId}
        />
      </main>
    </SidebarProvider>
  )
}
