import { NextRequest, NextResponse } from 'next/server'

const HOME = process.env.HOME || '/'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dirPath = searchParams.get('path') || HOME

  // Filesystem browsing only works in local mode
  if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_FS) {
    return NextResponse.json({ items: [], current: dirPath, parent: dirPath, note: 'File browser disabled in cloud mode' })
  }

  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const { existsSync } = await import('fs')

    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const items = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith('.'))
        .map(async (e) => {
          const fullPath = path.join(dirPath, e.name)
          const isDir = e.isDirectory()
          let size = 0
          if (!isDir && existsSync(fullPath)) {
            const stat = await fs.stat(fullPath)
            size = stat.size
          }
          return { name: e.name, path: fullPath, isDir, size }
        })
    )
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return NextResponse.json({ items, current: dirPath, parent: path.dirname(dirPath) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
