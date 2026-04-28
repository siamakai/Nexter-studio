import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'

async function getTodayMeetings(): Promise<string> {
  const lines: string[] = []

  // Google Calendar
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const cal = google.calendar({ version: 'v3', auth })
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date(); end.setHours(23, 59, 59, 999)
      const { data } = await cal.events.list({
        calendarId: 'primary',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      })
      for (const e of data.items || []) {
        const t = new Date(e.start?.dateTime || e.start?.date || '').toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
        const attendees = (e.attendees || []).filter(a => !a.self).map(a => a.email).join(', ')
        lines.push(`  ${t} — ${e.summary}${attendees ? ` (${attendees})` : ''}`)
      }
    } catch { /* skip */ }
  }

  // Microsoft Calendar
  if (process.env.MS_REFRESH_TOKEN) {
    try {
      const token = await getMsAccessToken('siamak.goudarzi@nexterlaw.com')
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date(); end.setHours(23, 59, 59, 999)
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}&$select=subject,start,end,attendees&$orderby=start/dateTime`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        const data = await res.json()
        for (const e of data.value || []) {
          const t = new Date(e.start?.dateTime + 'Z').toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
          const attendees = (e.attendees || []).filter((a: { type: string }) => a.type !== 'required' || true).map((a: { emailAddress: { address: string } }) => a.emailAddress?.address).slice(0, 2).join(', ')
          lines.push(`  ${t} — ${e.subject}${attendees ? ` (${attendees})` : ''} [Outlook]`)
        }
      }
    } catch { /* skip */ }
  }

  return lines.length ? lines.join('\n') : '  No meetings scheduled today'
}

async function getUrgentEmails(): Promise<string> {
  const lines: string[] = []
  if (!process.env.GOOGLE_REFRESH_TOKEN) return '  (Gmail not connected)'
  try {
    const auth = await getAuthedClient()
    const gmail = google.gmail({ version: 'v1', auth })
    const since = Math.floor((Date.now() - 20 * 60 * 60 * 1000) / 1000)
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${since} is:unread -category:promotions -category:updates -from:me`,
      maxResults: 8,
    })
    if (!data.messages?.length) return '  No urgent unread emails'
    const emails = await Promise.all(data.messages.slice(0, 5).map(async msg => {
      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'Subject'] })
      const get = (n: string) => full.payload?.headers?.find(h => h.name === n)?.value || ''
      return `  From: ${get('From').replace(/<.*>/, '').trim()} — "${get('Subject')}"`
    }))
    lines.push(...emails)
  } catch { lines.push('  (Gmail error)') }
  return lines.join('\n') || '  No urgent emails'
}

async function getHotLeads(): Promise<string> {
  if (!process.env.GHL_API_KEY) return '  (CRM not connected)'
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=50&sortBy=dateAdded&sortDirection=desc`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const hot = (data.contacts || []).filter((c: Record<string, unknown>) => {
      const tags = (c.tags as string[]) || []
      const added = new Date(c.dateAdded as string)
      return tags.some(t => t.toLowerCase() === 'hot') && added > new Date(since)
    })
    if (!hot.length) return '  No new hot leads in last 48h'
    return hot.map((c: Record<string, unknown>) =>
      `  🔥 ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} | ${c.companyName || ''}`
    ).join('\n')
  } catch { return '  (CRM error)' }
}

async function getOverdueFollowups(): Promise<string> {
  if (!process.env.GHL_API_KEY) return '  (CRM not connected)'
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=100`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const stale = (data.contacts || []).filter((c: Record<string, unknown>) => {
      const updated = new Date((c.dateUpdated || c.dateAdded) as string)
      const tags = (c.tags as string[]) || []
      return updated < cutoff && tags.some(t => ['hot', 'warm'].includes(t.toLowerCase()))
    }).slice(0, 5)
    if (!stale.length) return '  All hot/warm leads are up to date ✓'
    return stale.map((c: Record<string, unknown>) => {
      const d = Math.floor((Date.now() - new Date((c.dateUpdated || c.dateAdded) as string).getTime()) / 86400000)
      return `  ⚠️ ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} — ${d} days no contact`
    }).join('\n')
  } catch { return '  (CRM error)' }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [meetings, emails, hotLeads, overdue] = await Promise.all([
    getTodayMeetings(),
    getUrgentEmails(),
    getHotLeads(),
    getOverdueFollowups(),
  ])

  const today = new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are the personal executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.
Write his morning briefing for ${today}. Be direct, sharp, and action-oriented. No fluff.

DATA:

TODAY'S MEETINGS:
${meetings}

UNREAD EMAILS (last 20h):
${emails}

NEW HOT LEADS (last 48h):
${hotLeads}

OVERDUE FOLLOW-UPS (3+ days):
${overdue}

FORMAT (plain text, no markdown symbols):
- One executive summary sentence
- MEETINGS section (only if meetings exist)
- EMAILS TO ACTION (only if urgent emails)
- PRIORITY CONTACTS: who to call/email today and why
- ONE THING: single most important action for today`,
    }],
  })

  const briefing = (aiRes.content[0] as { type: 'text'; text: string }).text

  // Send via Gmail
  let emailSent = false
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const subject = `Morning Briefing — ${today}`
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', briefing].join('\r\n')
      ).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      emailSent = true
    } catch (err) {
      console.error('[Briefing] Email error:', err)
    }
  }

  return NextResponse.json({ ok: true, emailSent, briefing })
}
