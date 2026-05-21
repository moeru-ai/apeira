import type { LocalThread } from '../hooks/use-threads'

import { Plus } from 'lucide-react'

import { ThreadRow } from './thread-row'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  // SidebarRail,
} from './ui/sidebar'

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
    <Sidebar>
      <SidebarContent>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                Apeira
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarGroup>
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
          <SidebarGroupAction onClick={onCreateThread}>
            <Plus />
            {' '}
            <span className="sr-only">New Thread</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* <SidebarRail /> */}
    </Sidebar>
  )
}
