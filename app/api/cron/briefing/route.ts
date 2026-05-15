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

// ── Pipeline summary from GHL ─────────────────────────────────────────────────

async function getPipelineSummary(): Promise<string> {
  if (!process.env.GHL_API_KEY || !process.env.GHL_PIPELINE_ID) return '  (Pipeline not configured)'
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/opportunities/search/?location_id=${process.env.GHL_LOCATION_ID}&pipeline_id=${process.env.GHL_PIPELINE_ID}&status=open&limit=100`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    if (!res.ok) return '  (Pipeline fetch failed)'
    const data = await res.json()
    const opps: Record<string, unknown>[] = data.opportunities || []

    if (!opps.length) return '  No active opportunities in pipeline'

    // Map stage IDs to friendly names
    const stageNames: Record<string, string> = {
      [process.env.GHL_STAGE_NEW_LEAD    || '']: 'New Lead',
      [process.env.GHL_STAGE_QUALIFIED   || '']: 'Qualified',
      [process.env.GHL_STAGE_PROPOSAL    || '']: 'Proposal',
      [process.env.GHL_STAGE_NEGOTIATION || '']: 'Negotiation',
      [process.env.GHL_STAGE_WON        || '']: 'Won',
    }

    const counts: Record<string, number> = {}
    let totalValue = 0

    for (const opp of opps) {
      const stageId = (opp.pipelineStageId as string) || ''
      const name    = stageNames[stageId] || 'Other'
      counts[name]  = (counts[name] || 0) + 1
      totalValue   += (opp.monetaryValue as number) || 0
    }

    const stageOrder = ['New Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Other']
    const lines: string[] = [`  Total active: ${opps.length} opportunities`]
    for (const stage of stageOrder) {
      if (counts[stage]) {
        const icon = stage === 'Proposal' || stage === 'Negotiation' ? ' ⚡' : stage === 'Won' ? ' ✅' : ''
        lines.push(`  ${stage}: ${counts[stage]}${icon}`)
      }
    }
    if (totalValue > 0) lines.push(`  Pipeline value: $${totalValue.toLocaleString()}`)
    return lines.join('\n')
  } catch {
    return '  (CRM error)'
  }
}

// ── Today's meetings ──────────────────────────────────────────────────────────

async function getTodayMeetings(): Promise<{ text: string; totalHours: number; events: { start: string; end: string; summary: string }[] }> {
  const lines:  string[] = []
  const events: { start: string; end: string; summary: string }[] = []

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const cal  = google.calendar({ version: 'v3', auth })
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end   = new Date(); end.setHours(23, 59, 59, 999)
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
      const end   = new Date(); end.setHours(23, 59, 59, 999)
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

  const totalHours = events.reduce((sum, e) => sum + (new Date(e.end).getTime() - new Date(e.start).getTime()) / 3600000, 0)
  return { text: lines.length ? lines.join('\n') : '  No meetings scheduled today', totalHours, events }
}

// ── Focus block ───────────────────────────────────────────────────────────────

async function createFocusBlock(events: { start: string; end: string }[]): Promise<boolean> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return false
  try {
    const auth = await getAuthedClient()
    const cal  = google.calendar({ version: 'v3', auth })
    const dayStart = new Date(); dayStart.setHours(9, 0, 0, 0)
    const dayEnd   = new Date(); dayEnd.setHours(18, 0, 0, 0)

    const busySlots = events.map(e => ({
      start: new Date(e.start).getTime(),
      end:   new Date(e.end).getTime(),
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
        end:   { dateTime: new Date(candidate + 90 * 60 * 1000).toISOString() },
        colorId: '9',
      },
    })
    return true
  } catch { return false }
}

// ── Unread emails ─────────────────────────────────────────────────────────────

async function getUrgentEmails(): Promise<string> {
  const lines: string[] = []
  if (!process.env.GOOGLE_REFRESH_TOKEN) return '  (Gmail not connected)'
  try {
    const auth  = await getAuthedClient()
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

// ── Hot leads ─────────────────────────────────────────────────────────────────

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

// ── Overdue follow-ups ────────────────────────────────────────────────────────

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
    })
    if (!stale.length) return '  All hot/warm leads are up to date ✓'

    const withMeta = stale.map((c: Record<string, unknown>) => {
      const tags = ((c.tags as string[]) || []).map(t => t.toLowerCase())
      const temp = tags.includes('hot') ? 'hot' : 'warm'
      const days = Math.floor((Date.now() - new Date((c.dateUpdated || c.dateAdded) as string).getTime()) / 86400000)
      return { c, temp, days }
    }).sort((a: { temp: string; days: number }, b: { temp: string; days: number }) => {
      if (a.temp !== b.temp) return a.temp === 'hot' ? -1 : 1
      return b.days - a.days
    }).slice(0, 6)

    return withMeta.map(({ c, temp, days }: { c: Record<string, unknown>; temp: string; days: number }) => {
      const icon   = temp === 'hot' ? '🔥 HOT' : '🌡️ WARM'
      const urgent = days >= 7 ? ' ⚠️ URGENT' : ''
      return `  ${icon}${urgent} — ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} | ${days} days no contact`
    }).join('\n')
  } catch { return '  (CRM error)' }
}

// ── HTML email builder ────────────────────────────────────────────────────────

function buildBriefingHtml(opts: {
  today: string
  oneThing: string
  briefingBody: string
  pipeline: string
  focusBlockCreated: boolean
}): string {
  const { today, oneThing, briefingBody, pipeline, focusBlockCreated } = opts

  const bodyHtml = briefingBody
    .split('\n')
    .map(line => {
      if (!line.trim()) return '<br/>'
      if (/^[A-Z ]+:/.test(line.trim())) {
        return `<p style="margin:14px 0 4px;font-weight:700;color:#0F2347;font-size:0.88rem;font-family:monospace;letter-spacing:0.05em;">${line}</p>`
      }
      return `<p style="margin:2px 0;color:#333;font-size:0.85rem;line-height:1.6;">${line}</p>`
    })
    .join('\n')

  const pipelineRows = pipeline
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<div style="font-size:0.82rem;color:#333;padding:2px 0;">${l.trim()}</div>`)
    .join('')

  return `
<div style="font-family:Georgia,serif;max-width:660px;margin:0 auto;color:#1a2035;">

  <!-- Header -->
  <div style="background:#0F2347;padding:18px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1.05rem;">☀️ Morning Briefing</h2>
    <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:0.78rem;font-family:monospace;">${today}</p>
    ${focusBlockCreated ? '<p style="color:#ffc107;margin:4px 0 0;font-size:0.75rem;font-family:monospace;">📅 Focus block auto-added to calendar</p>' : ''}
  </div>

  <!-- ONE THING — gold highlight box -->
  <div style="background:#B8963E;padding:14px 20px;border-left:none;border-right:none;">
    <p style="margin:0;font-size:0.7rem;color:rgba(255,255,255,0.75);font-family:monospace;letter-spacing:0.08em;text-transform:uppercase;">ONE THING TODAY</p>
    <p style="margin:6px 0 0;font-size:1rem;color:#fff;font-weight:700;line-height:1.4;">${oneThing}</p>
  </div>

  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;">

    <!-- Pipeline snapshot -->
    ${pipeline && !pipeline.includes('not configured') ? `
    <div style="background:#f5f1ea;border-radius:6px;padding:12px 16px;margin-bottom:18px;">
      <p style="margin:0 0 8px;font-size:0.72rem;font-family:monospace;font-weight:700;color:#0F2347;letter-spacing:0.06em;text-transform:uppercase;">PIPELINE SNAPSHOT</p>
      ${pipelineRows}
    </div>` : ''}

    <!-- Briefing body -->
    <div style="border-left:3px solid #B8963E;padding-left:14px;">
      ${bodyHtml}
    </div>

    <p style="margin-top:18px;font-size:0.7rem;color:#aaa;border-top:1px solid #ede5d6;padding-top:10px;font-family:monospace;">
      Nexter AI VA · Morning Briefing · Auto-generated · For internal use only
    </p>
  </div>
</div>`
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [meetingData, emails, hotLeads, overdue, openTasks, contentSummary, delegationSummary, pipeline] = await Promise.all([
    getTodayMeetings(),
    getUrgentEmails(),
    getHotLeads(),
    getOverdueFollowups(),
    getOpenTasksText(),
    getContentSummary(),
    getDelegationSummary(),
    getPipelineSummary(),
  ])

  let focusBlockCreated = false
  if (meetingData.totalHours >= 4) {
    focusBlockCreated = await createFocusBlock(meetingData.events)
  }

  const today = new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are the personal executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.
Write his morning briefing for ${today}. Be direct, sharp, and action-oriented. No fluff.

DATA:

TODAY'S MEETINGS (${meetingData.totalHours.toFixed(1)}h total):
${meetingData.text}

UNREAD EMAILS (last 20h):
${emails}

NEW HOT LEADS (last 48h):
${hotLeads}

OVERDUE FOLLOW-UPS (hot/warm, 3+ days no contact):
${overdue}

PIPELINE:
${pipeline}

OPEN TASKS:
${openTasks || '  No open tasks'}

CONTENT PIPELINE:
${contentSummary}

TEAM DELEGATIONS:
${delegationSummary}

FORMAT — use these exact section headings, plain text, be specific:

ONE THING: [single most important action today — one sentence, be specific, name the person or task]

MEETINGS: [list only if meetings today]
EMAILS TO ACTION: [only if urgent emails]
PIPELINE: [proposals/negotiations that need pushing today]
PRIORITY CONTACTS: [who to reach and why, hot first]
OPEN TASKS: [top 3-5, HIGH priority first]
TEAM: [overdue delegations — name the person]
CONTENT: [overdue or this week's gaps]

Start your response with the ONE THING line. No intro sentence before it.`,
    }],
  })

  const briefingText = (aiRes.content[0] as { type: 'text'; text: string }).text

  // Extract ONE THING from first line of Claude output
  const lines = briefingText.split('\n').map(l => l.trim()).filter(Boolean)
  const oneThingLine = lines.find(l => l.toUpperCase().startsWith('ONE THING:')) || ''
  const oneThing  = oneThingLine.replace(/^ONE THING:\s*/i, '').trim() || 'Review your pipeline and follow up with the most overdue hot lead.'
  const briefingBody = briefingText.replace(oneThingLine, '').trim()

  const html = buildBriefingHtml({ today, oneThing, briefingBody, pipeline, focusBlockCreated })

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth  = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to      = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const subject = `=?utf-8?B?${Buffer.from(`☀️ Morning Briefing — ${today}`).toString('base64')}?=`
      const raw = Buffer.from([
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        html,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch (err) {
      console.error('[Briefing] Email error:', err)
    }
  }

  return NextResponse.json({ ok: true, focusBlockCreated, meetingHours: meetingData.totalHours, oneThing, briefing: briefingText })
}
