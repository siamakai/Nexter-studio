/**
 * Weekly Review Generator
 * Runs daily but only generates a report on Fridays.
 * Summarizes the week: meetings, leads, tasks, revenue, content pipeline,
 * and calendar (Google + Outlook). Gives 3 priorities for next week.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'
import { getOpenTasksText, getTasks, getRecentMeetings, getContentSummary } from '@/lib/supabase'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'

async function getWeekMeetings(): Promise<string> {
  try {
    const meetings = await getRecentMeetings(7)
    if (!meetings.length) return 'No meeting reports this week'
    return meetings.map(m =>
      `${m.date} — ${m.title}\nAttendees: ${m.attendees || 'N/A'}\n${m.summary.slice(0, 200)}`
    ).join('\n\n---\n\n')
  } catch { return 'Unable to read meeting reports' }
}

async function getWeekLeads(): Promise<string> {
  if (!process.env.GHL_API_KEY) return 'CRM not connected'
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=50&sortBy=date_added`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const weekLeads = (data.contacts || []).filter((c: Record<string, unknown>) =>
      new Date(c.dateAdded as string) >= new Date(since)
    )
    if (!weekLeads.length) return 'No new leads this week'
    const hot  = weekLeads.filter((c: Record<string, unknown>) => ((c.tags as string[]) || []).includes('hot')).length
    const warm = weekLeads.filter((c: Record<string, unknown>) => ((c.tags as string[]) || []).includes('warm')).length
    const names = weekLeads.slice(0, 5).map((c: Record<string, unknown>) =>
      `${c.firstName || ''} ${c.lastName || ''} (${c.companyName || 'unknown company'})`
    ).join(', ')
    return `Total: ${weekLeads.length} new contacts | Hot: ${hot} | Warm: ${warm}\nTop contacts: ${names}`
  } catch { return 'CRM error' }
}

async function getWeekCalendar(): Promise<string> {
  const lines: string[] = []
  let totalEvents = 0
  let totalHours  = 0

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weekEnd   = new Date()

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const cal  = google.calendar({ version: 'v3', auth })
      const { data } = await cal.events.list({
        calendarId: 'primary',
        timeMin: weekStart.toISOString(),
        timeMax: weekEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      })
      const events = (data.items || []).filter(e => e.start?.dateTime)
      totalEvents += events.length
      totalHours  += events.reduce((sum, e) =>
        sum + (new Date(e.end?.dateTime || 0).getTime() - new Date(e.start?.dateTime || 0).getTime()) / 3600000, 0
      )
      for (const e of events.slice(0, 8)) {
        const day = new Date(e.start?.dateTime || '').toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
        lines.push(`  ${day} — ${e.summary}`)
      }
    } catch { /* skip */ }
  }

  if (process.env.MS_REFRESH_TOKEN) {
    try {
      const token = await getMsAccessToken('siamak.goudarzi@nexterlaw.com')
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${weekStart.toISOString()}&endDateTime=${weekEnd.toISOString()}&$select=subject,start,end&$orderby=start/dateTime`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        const data = await res.json()
        const events: Record<string, unknown>[] = data.value || []
        totalEvents += events.length
        totalHours  += events.reduce((sum, e) => {
          const s = e.start as Record<string, string>
          const en = e.end as Record<string, string>
          return sum + (new Date(en.dateTime + 'Z').getTime() - new Date(s.dateTime + 'Z').getTime()) / 3600000
        }, 0)
        for (const e of events.slice(0, 8)) {
          const s = e.start as Record<string, string>
          const day = new Date(s.dateTime + 'Z').toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
          lines.push(`  ${day} — ${e.subject} [Outlook]`)
        }
      }
    } catch { /* skip */ }
  }

  if (!totalEvents) return 'No calendar events this week'
  return `${totalEvents} meetings | ${totalHours.toFixed(1)} hours total\n` + lines.join('\n')
}

async function getTasksReport(): Promise<string> {
  try {
    const [open, done] = await Promise.all([getTasks(false), getTasks(true)])
    const text = await getOpenTasksText()
    return `Open: ${open.length} tasks | Completed: ${done.length}\n${text}`
  } catch { return 'No tasks found' }
}

async function getWeekRevenue(): Promise<string> {
  if (!process.env.GHL_API_KEY || !process.env.GHL_PIPELINE_ID) return 'Pipeline not configured'
  try {
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Won this week
    const wonRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/search/?location_id=${process.env.GHL_LOCATION_ID}&pipeline_id=${process.env.GHL_PIPELINE_ID}&status=won&limit=100`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const wonData = await wonRes.json()
    const wonThisWeek = (wonData.opportunities || []).filter((o: Record<string, unknown>) =>
      new Date((o.updatedAt || o.createdAt) as string) >= weekStart
    )
    const wonRevenue = wonThisWeek.reduce((s: number, o: Record<string, unknown>) => s + ((o.monetaryValue as number) || 0), 0)

    // All open pipeline
    const openRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/search/?location_id=${process.env.GHL_LOCATION_ID}&pipeline_id=${process.env.GHL_PIPELINE_ID}&status=open&limit=100`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const openData = await openRes.json()
    const openOpps: Record<string, unknown>[] = openData.opportunities || []

    const stageNames: Record<string, string> = {
      [process.env.GHL_STAGE_NEW_LEAD    || '']: 'New Lead',
      [process.env.GHL_STAGE_QUALIFIED   || '']: 'Qualified',
      [process.env.GHL_STAGE_PROPOSAL    || '']: 'Proposal',
      [process.env.GHL_STAGE_NEGOTIATION || '']: 'Negotiation',
    }

    // Deals moved into Proposal or Negotiation this week
    const advanced = openOpps.filter((o: Record<string, unknown>) => {
      const stageId  = (o.pipelineStageId as string) || ''
      const stageName = stageNames[stageId] || ''
      const updated  = new Date((o.updatedAt || o.createdAt) as string)
      return (stageName === 'Proposal' || stageName === 'Negotiation') && updated >= weekStart
    })

    const pipelineValue = openOpps.reduce((s: number, o: Record<string, unknown>) => s + ((o.monetaryValue as number) || 0), 0)

    const lines = [
      wonThisWeek.length
        ? `Won this week: ${wonThisWeek.length} deal(s) — €${wonRevenue.toLocaleString()}`
        : 'No deals won this week',
      advanced.length
        ? `Deals moved to Proposal/Negotiation: ${advanced.length} (${advanced.map((o: Record<string, unknown>) => o.name).join(', ')})`
        : 'No new deals advanced to proposal stage',
      `Total open pipeline: ${openOpps.length} deals — €${pipelineValue.toLocaleString()}`,
    ]

    const stageOrder = ['New Lead', 'Qualified', 'Proposal', 'Negotiation']
    const counts: Record<string, number> = {}
    for (const opp of openOpps) {
      const name = stageNames[(opp.pipelineStageId as string) || ''] || 'Other'
      counts[name] = (counts[name] || 0) + 1
    }
    for (const stage of stageOrder) {
      if (counts[stage]) lines.push(`  ${stage}: ${counts[stage]}`)
    }

    return lines.join('\n')
  } catch { return 'CRM error fetching revenue data' }
}

// ── HTML email builder ────────────────────────────────────────────────────────

function buildWeeklyHtml(opts: { weekEnding: string; review: string }): string {
  const { weekEnding, review } = opts
  const bodyHtml = review
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/^(#{1,3} .+)$/gm, '<strong>$1</strong>')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0">
  <tr><td align="center">
    <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
      <!-- Header -->
      <tr><td style="background:#0F2347;padding:28px 32px">
        <p style="margin:0;color:#B8963E;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">NEXTER AI GROUP</p>
        <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700">📊 Weekly Review</h1>
        <p style="margin:6px 0 0;color:#8899aa;font-size:13px">Week Ending ${weekEnding}</p>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:28px 32px;color:#1a1a2e;font-size:14px;line-height:1.7">
        ${bodyHtml}
      </td></tr>
      <!-- Footer -->
      <tr><td style="background:#0F2347;padding:16px 32px;text-align:center">
        <p style="margin:0;color:#556677;font-size:11px">Nexter AI VA · Auto-generated weekly review</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today      = new Date()
  const dayOfWeek  = today.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' })
  const force      = req.nextUrl.searchParams.get('force') === '1'

  if (dayOfWeek !== 'Friday' && !force) {
    return NextResponse.json({ ok: true, skipped: true, message: `Not Friday (${dayOfWeek}) — skipping weekly review` })
  }

  const [meetings, leads, calendar, tasks, revenue, content] = await Promise.all([
    getWeekMeetings(),
    getWeekLeads(),
    getWeekCalendar(),
    getTasksReport(),
    getWeekRevenue(),
    getContentSummary().catch(() => 'Content pipeline data unavailable'),
  ])

  const weekEnding = today.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are the executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.
Generate his weekly review for the week ending ${weekEnding}. Be sharp and actionable.

DATA:

CALENDAR THIS WEEK (Google + Outlook):
${calendar}

MEETING REPORTS:
${meetings}

NEW LEADS THIS WEEK:
${leads}

REVENUE & PIPELINE THIS WEEK:
${revenue}

CONTENT PIPELINE:
${content}

TASKS STATUS:
${tasks}

Write a weekly review with these sections (plain text, use ALL CAPS headings):

WEEK IN REVIEW
One paragraph: what was accomplished, what momentum exists.

WHAT MOVED
Bullet list of significant progress this week (meetings held, deals advanced, content published, tasks completed).

WHAT'S STUCK
Bullet list of anything delayed, blocked, or needs attention.

REVENUE SNAPSHOT
Brief summary of the week's revenue activity — deals won, pipeline advanced, current open value. Be specific with numbers.

OPEN TASKS (top 5 priority)
Numbered list, highest priority first.

YOUR 3 HIGHEST-LEVERAGE ACTIONS NEXT WEEK
Must be specific, revenue or relationship-focused, and actionable on Monday morning. Not vague goals — specific names, numbers, or outcomes.`,
    }],
  })

  const review = (res.content[0] as { text: string }).text

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth   = await getAuthedClient()
      const gmail  = google.gmail({ version: 'v1', auth })
      const to     = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const html   = buildWeeklyHtml({ weekEnding, review })
      const boundary = 'boundary_weekly_review'
      const raw = Buffer.from([
        `To: ${to}`,
        `Subject: =?utf-8?B?${Buffer.from(`📊 Weekly Review — Week Ending ${weekEnding}`).toString('base64')}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        review,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        html,
        '',
        `--${boundary}--`,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch (err) {
      console.error('[weekly-review] Email error:', err)
    }
  }

  return NextResponse.json({ ok: true, weekEnding, review })
}
