import { NextRequest, NextResponse } from 'next/server'
import { storeIncomingMessage } from '@/lib/tools/whatsapp'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'nexterai_whatsapp_2026'

// Meta sends a GET to verify the webhook URL
export async function GET(req: NextRequest) {
  const mode      = req.nextUrl.searchParams.get('hub.mode')
  const token     = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified')
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Meta sends a POST for each incoming message
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const entry = body?.entry?.[0]
    const changes = entry?.changes?.[0]
    const value = changes?.value

    if (value?.messages) {
      for (const msg of value.messages) {
        const contact = value.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)
        storeIncomingMessage({
          id:        msg.id,
          from:      msg.from,
          name:      contact?.profile?.name || msg.from,
          body:      msg.type === 'text' ? msg.text?.body : `[${msg.type} message]`,
          timestamp: msg.timestamp,
          type:      msg.type,
        })
        console.log(`[WhatsApp] Message from ${contact?.profile?.name || msg.from}: ${msg.text?.body?.slice(0, 80)}`)
      }
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('[WhatsApp webhook]', err)
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
