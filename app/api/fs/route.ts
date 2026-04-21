import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

const HOME = process.env.HOME || '/'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dirPath = searchParams.get('path') || HOME

  try {
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
