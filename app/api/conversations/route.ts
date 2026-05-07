import { NextRequest, NextResponse } from 'next/server'
import { saveChatSession, listChatSessions, loadChatSession, deleteChatSession } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  try {
    if (id) {
      const session = await loadChatSession(id)
      return NextResponse.json(session)
    }
    const sessions = await listChatSessions()
    return NextResponse.json(sessions)
  } catch (err) {
    console.error('[Conversations GET]', err)
    return NextResponse.json([], { status: 200 }) // return empty array so UI doesn't break
  }
}

export async function POST(req: NextRequest) {
  try {
    const { id, title, messages } = await req.json()
    await saveChatSession(id, title, messages)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Conversations POST]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await deleteChatSession(id)
  return NextResponse.json({ ok: true })
}
