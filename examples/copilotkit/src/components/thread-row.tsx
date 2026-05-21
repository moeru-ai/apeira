/* eslint-disable @masknet/jsx-no-logical */
import type { LocalThread } from '../hooks/use-threads'

import { Edit, MoreHorizontal, Trash } from 'lucide-react'
import { useState } from 'react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Input } from './ui/input'
import { SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'

interface ThreadRowProps {
  active: boolean
  onArchive: () => void
  onRename: (name: string) => void
  onSelect: () => void
  thread: LocalThread
}

export const ThreadRow = ({ active, onArchive, onRename, onSelect, thread }: ThreadRowProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(thread.name ?? '')

  const displayName = thread.name ?? 'New conversation'
  const timeAgo = new Date(thread.updatedAt).toLocaleDateString()

  const commitRename = () => {
    onRename(editName)
    setIsEditing(false)
  }

  return (
    <SidebarMenuItem>
      {isEditing
        ? (
            <div className="flex items-center px-2 py-1">
              <Input
                autoFocus
                className="h-8 text-sm"
                onBlur={commitRename}
                onChange={e => setEditName(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter')
                    return

                  commitRename()
                }}
                value={editName}
              />
            </div>
          )
        : (
            <SidebarMenuButton isActive={active} onClick={onSelect}>
              {displayName}
            </SidebarMenuButton>
          )}
      <SidebarMenuBadge className="mr-5">{timeAgo}</SidebarMenuBadge>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation()
            setIsEditing(true)
            setEditName(thread.name ?? '')
          }}
          >
            <Edit />
            {' '}
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation()
            onArchive()
          }}
          >
            <Trash />
            {' '}
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
