import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'
import { getOpenTasksText, getContentSummary, getDelegationSummary } from '@/lib/supabase'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'

async function getTodayMeetings(): Promise<{ text: string; totalHours: number; events: { start: string; end: string; summary: string }[] }> {
  const lines: string[] = []
  const events: { start: string; end: string; summary: string }[] = []

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
        if (e.start?.dateTime && e.end?.dateTime) {
          events.push({ start: e.start.dateTime, end: e.end.dateTime, summary: e.summary || '' })
        }
      }
    } catch { /* skip */ }
  }

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
          const attendees = (e.attendees || []).map((a: { emailAddress: { address: string } }) => a.emailAddress?.address).slice(0, 2).join(', ')
          lines.push(`  ${t} — ${e.subject}${attendees ? ` (${attendees})` : ''} [Outlook]`)
          if (e.start?.dateTime && e.end?.dateTime) {
            events.push({ start: e.start.dateTime + 'Z', end: e.end.dateTime + 'Z', summary: e.subject || '' })
          }
        }
      }
    } catch { /* skip */ }
  }

  const totalHours = events.reduce((sum, e) => {
    return sum + (new Date(e.end).getTime() - new Date(e.start).getTime()) / 3600000
  }, 0)

  return {
    text: lines.length ? lines.join('\n') : '  No meetings scheduled today',
    totalHours,
    events,
  }
}

async function createFocusBlock(events: { start: string; end: string }[]): Promise<boolean> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return false
  try {
    const auth = await getAuthedClient()
    const cal = google.calendar({ version: 'v3', auth })

    // Find a 90-min gap between 9am-6pm not occupied by meetings
    const dayStart = new Date(); dayStart.setHours(9, 0, 0, 0)
    const dayEnd = new Date(); dayEnd.setHours(18, 0, 0, 0)

    const busySlots = events.map(e => ({
      start: new Date(e.start).getTime(),
      end: new Date(e.end).getTime(),
    })).sort((a, b) => a.start - b.start)

    let candidate = dayStart.getTime()
    for (const slot of busySlots) {
      if (slot.start - candidate >= 90 * 60 * 1000) break
      candidate = slot.end
    }

    if (candidate + 90 * 60 * 1000 > dayEnd.getTime()) return false

    await cal.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: '🔒 Focus Block — Protected (Nexter AI VA)',
        description: 'Auto-blocked by Nexter AI VA — heavy meeting day detected.',
        start: { dateTime: new Date(candidate).toISOString() },
        end: { dateTime: new Date(candidate + 90 * 60 * 1000).toISOString() },
        colorId: '9',
      },
    })
    return true
  } catch { return false }
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
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=50&sortBy=dateAdded&sortDirection=desc`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const since = Date.now() - 48 * 60 * 60 * 1000
    const hot = (data.contacts || []).filter((c: Record<string, unknown>) => {
      const tags = (c.tags as string[]) || []
      return tags.some(t => t.toLowerCase() === 'hot') && new Date(c.dateAdded as string).getTime() > since
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

  const [meetingData, emails, hotLeads, overdue, openTasks, contentSummary, delegationSummary] = await Promise.all([
    getTodayMeetings(),
    getUrgentEmails(),
    getHotLeads(),
    getOverdueFollowups(),
    getOpenTasksText(),
    getContentSummary(),
    getDelegationSummary(),
  ])

  // Calendar Defense — auto-block focus time if meeting-heavy day
  let focusBlockCreated = false
  if (meetingData.totalHours >= 4) {
    focusBlockCreated = await createFocusBlock(meetingData.events)
  }

  const today = new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are the personal executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.
Write his morning briefing for ${today}. Be direct, sharp, and action-oriented. No fluff.

DATA:

TODAY'S MEETINGS (${meetingData.totalHours.toFixed(1)}h total${focusBlockCreated ? ' — Focus block auto-added to calendar' : ''}):
${meetingData.text}

UNREAD EMAILS (last 20h):
${emails}

NEW HOT LEADS (last 48h):
${hotLeads}

OVERDUE FOLLOW-UPS (3+ days no contact):
${overdue}

OPEN TASKS:
${openTasks || '  No open tasks'}

CONTENT PIPELINE:
${contentSummary}

TEAM DELEGATIONS:
${delegationSummary}

FORMAT (plain text):
- One executive summary sentence
- MEETINGS (if any)
- EMAILS TO ACTION (if urgent)
- OPEN TASKS: list HIGH priority first
- PRIORITY CONTACTS: who to reach today and why
- CONTENT: any overdue or empty slots this week
- TEAM: any overdue delegations (name the person)
- ONE THING: the single most important action for today`,
    }],
  })

  const briefing = (aiRes.content[0] as { type: 'text'; text: string }).text

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const subject = `=?utf-8?B?${Buffer.from(`☀️ Morning Briefing — ${today}`).toString('base64')}?=`
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', briefing].join('\r\n')
      ).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch (err) {
      console.error('[Briefing] Email error:', err)
    }
  }

  return NextResponse.json({ ok: true, focusBlockCreated, meetingHours: meetingData.totalHours, briefing })
}
