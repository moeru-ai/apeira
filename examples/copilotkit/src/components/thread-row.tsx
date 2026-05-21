/* eslint-disable @masknet/jsx-no-logical */
import type { LocalThread } from '../hooks/use-threads'

import { useState } from 'react'

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

  return (
    <div
      className={[
        'group flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-gray-100',
        active ? 'bg-gray-100' : '',
      ].join(' ')}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        {isEditing
          ? (
              <input
                autoFocus
                className="w-full border rounded px-1 text-sm"
                onBlur={() => {
                  onRename(editName)
                  setIsEditing(false)
                }}
                onChange={e => setEditName(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter')
                    return
                  onRename(editName)
                  setIsEditing(false)
                }}
                value={editName}
              />
            )
          : (
              <>
                <div className="truncate text-sm">{displayName}</div>
                <div className="text-xs text-gray-400">{timeAgo}</div>
              </>
            )}
      </div>

      <div className="ml-2 hidden gap-1 group-hover:flex">
        <button
          className="text-xs text-gray-500 hover:text-gray-700"
          onClick={(e) => {
            e.stopPropagation()
            setIsEditing(true)
          }}
        >
          Rename
        </button>
        <button
          className="text-xs text-gray-500 hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation()
            onArchive()
          }}
        >
          Archive
        </button>
      </div>
    </div>
  )
}
