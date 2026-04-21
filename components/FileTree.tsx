'use client'

import { useState, useEffect, useCallback } from 'react'

interface FsItem { name: string; path: string; isDir: boolean; size: number }
interface FsResponse { items: FsItem[]; current: string; parent: string }

export default function FileTree({ onPathSelect }: { onPathSelect: (path: string) => void }) {
  const [data, setData] = useState<FsResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const browse = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const url = path ? `/api/fs?path=${encodeURIComponent(path)}` : '/api/fs'
      const res = await fetch(url)
      const json = await res.json()
      setData(json)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { browse() }, [browse])

  if (!data) return <div className="p-3 text-xs text-gray-600">{loading ? 'Loading...' : 'File browser'}</div>

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <span className="text-gray-500 font-medium uppercase tracking-wider text-[10px]">Files</span>
        <button onClick={() => browse()} className="text-gray-600 hover:text-gray-400">↺</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Current path */}
        <div className="px-3 py-1.5 text-gray-600 truncate text-[10px] font-mono border-b border-gray-900">
          {data.current}
        </div>

        {/* Up button */}
        {data.parent !== data.current && (
          <button
            onClick={() => browse(data.parent)}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
          >
            ↑ ..
          </button>
        )}

        {/* Items */}
        {data.items.map((item) => (
          <button
            key={item.path}
            onClick={() => item.isDir ? browse(item.path) : onPathSelect(item.path)}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-800 transition-colors flex items-center gap-2 group"
          >
            <span className="flex-shrink-0">{item.isDir ? '📁' : '📄'}</span>
            <span className={`truncate ${item.isDir ? 'text-blue-400' : 'text-gray-300 group-hover:text-white'}`}>
              {item.name}
            </span>
            {!item.isDir && item.size > 0 && (
              <span className="ml-auto text-gray-700 text-[10px] flex-shrink-0">
                {item.size > 1024 ? `${(item.size / 1024).toFixed(0)}k` : `${item.size}b`}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
