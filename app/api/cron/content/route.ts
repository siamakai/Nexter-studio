/**
 * Content Pipeline Monitor
 * Runs daily — checks for empty slots, overdue content, and sends a status email.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { listContent, getContentSummary } from '@/lib/supabase'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await listContent()
  const summary = await getContentSummary()

  const overdue = items.filter(i => i.scheduled_date && new Date(i.scheduled_date) < new Date() && i.status !== 'published')
  const emptyNextWeek = (() => {
    const next7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i + 1)
      return d.toISOString().split('T')[0]
    })
    const scheduled = items.filter(i => i.status === 'scheduled').map(i => i.scheduled_date)
    return next7.filter(d => !scheduled.includes(d)).length
  })()

  // Only send email if there are issues to flag
  if (!overdue.length && emptyNextWeek < 5 && items.length > 0) {
    return NextResponse.json({ ok: true, message: 'Content pipeline healthy', items: items.length })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a brief content pipeline alert for Siamak (Founder, Nexter AI Group). Be direct, max 5 sentences.

PIPELINE STATUS:
${summary}

Overdue items: ${overdue.length}
Empty slots next 7 days: ${emptyNextWeek}

Flag what needs attention and suggest one specific action.`,
    }],
  })

  const alert = (res.content[0] as { text: string }).text

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const raw = Buffer.from([
        `To: ${to}`,
        `Subject: 📱 Content Pipeline — ${overdue.length} overdue, ${emptyNextWeek} empty slots`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        alert + '\n\n---\nFull pipeline:\n' + summary,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch (err) {
      console.error('[content-cron] Email error:', err)
    }
  }

  return NextResponse.json({ ok: true, overdue: overdue.length, emptyNextWeek, alert })
}
