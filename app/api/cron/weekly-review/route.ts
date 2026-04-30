/**
 * Weekly Review Generator
 * Runs daily but only generates a report on Fridays.
 * Summarizes the week: meetings, leads, tasks, and gives 3 priorities for next week.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import fs from 'fs/promises'
import path from 'path'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'

async function getWeekMeetings(): Promise<string> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return 'Not available'
  try {
    // Read meeting files created this week
    const dir = path.join(process.cwd(), 'meetings')
    const files = await fs.readdir(dir).catch(() => [] as string[])
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const weekFiles = files.filter(f => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})/)
      if (!match) return false
      return new Date(match[1]) >= weekAgo
    })
    if (!weekFiles.length) return 'No meeting reports this week'
    const summaries = await Promise.all(weekFiles.slice(0, 5).map(async f => {
      const content = await fs.readFile(path.join(dir, f), 'utf-8')
      return content.split('\n').slice(0, 6).join('\n')
    }))
    return summaries.join('\n\n---\n\n')
  } catch { return 'Unable to read meeting files' }
}

async function getWeekLeads(): Promise<string> {
  if (!process.env.GHL_API_KEY) return 'CRM not connected'
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=50&sortBy=dateAdded&sortDirection=desc`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const weekLeads = (data.contacts || []).filter((c: Record<string, unknown>) =>
      new Date(c.dateAdded as string) >= new Date(since)
    )
    if (!weekLeads.length) return 'No new leads this week'
    const hot = weekLeads.filter((c: Record<string, unknown>) => (c.tags as string[] || []).includes('hot')).length
    const warm = weekLeads.filter((c: Record<string, unknown>) => (c.tags as string[] || []).includes('warm')).length
    const names = weekLeads.slice(0, 5).map((c: Record<string, unknown>) =>
      `${c.firstName || ''} ${c.lastName || ''} (${c.companyName || 'unknown company'})`
    ).join(', ')
    return `Total: ${weekLeads.length} new contacts | Hot: ${hot} | Warm: ${warm}\nTop contacts: ${names}`
  } catch { return 'CRM error' }
}

async function getWeekCalendar(): Promise<string> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return 'Not available'
  try {
    const auth = await getAuthedClient()
    const cal = google.calendar({ version: 'v3', auth })
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const end = new Date()
    const { data } = await cal.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    })
    const events = (data.items || []).filter(e => e.start?.dateTime)
    if (!events.length) return 'No meetings this week'
    const totalHours = events.reduce((sum, e) => {
      return sum + (new Date(e.end?.dateTime || 0).getTime() - new Date(e.start?.dateTime || 0).getTime()) / 3600000
    }, 0)
    const names = events.slice(0, 8).map(e => `  - ${e.summary}`).join('\n')
    return `${events.length} meetings | ${totalHours.toFixed(1)} hours total\n${names}`
  } catch { return 'Calendar error' }
}

async function getOpenTasks(): Promise<string> {
  try {
    const content = await fs.readFile(path.join(process.cwd(), 'tasks', 'open.md'), 'utf-8')
    const open = content.split('\n').filter(l => l.includes('- [ ]')).slice(0, 10)
    const done = content.split('\n').filter(l => l.includes('- [x]')).length
    return `Open: ${open.length} tasks | Completed this week: ${done}\n${open.join('\n')}`
  } catch { return 'No task file found' }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only generate on Fridays (day 5) — skip other days unless forced
  const today = new Date()
  const dayOfWeek = today.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' })
  const force = req.nextUrl.searchParams.get('force') === '1'

  if (dayOfWeek !== 'Friday' && !force) {
    return NextResponse.json({ ok: true, skipped: true, message: `Not Friday (${dayOfWeek}) — skipping weekly review` })
  }

  const [meetings, leads, calendar, tasks] = await Promise.all([
    getWeekMeetings(),
    getWeekLeads(),
    getWeekCalendar(),
    getOpenTasks(),
  ])

  const weekEnding = today.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are the executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.
Generate his weekly review for the week ending ${weekEnding}. Be sharp and actionable.

DATA:

CALENDAR THIS WEEK:
${calendar}

MEETING REPORTS:
${meetings}

NEW LEADS THIS WEEK:
${leads}

TASKS STATUS:
${tasks}

Write a weekly review with these sections (plain text):

WEEK IN REVIEW
One paragraph: what was accomplished, what momentum exists.

WHAT MOVED
Bullet list of significant progress this week.

WHAT'S STUCK
Bullet list of anything delayed, blocked, or needs attention.

OPEN TASKS (top 5 priority)
Numbered list, highest priority first.

YOUR 3 HIGHEST-LEVERAGE ACTIONS NEXT WEEK
These must be specific, revenue or relationship-focused, and actionable on Monday morning. Not vague goals — specific names, numbers, or outcomes.`,
    }],
  })

  const review = (res.content[0] as { text: string }).text

  // Email the review
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const auth = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const raw = Buffer.from([
        `To: ${to}`,
        `Subject: 📊 Weekly Review — Week Ending ${weekEnding}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        review,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch (err) {
      console.error('[weekly-review] Email error:', err)
    }
  }

  return NextResponse.json({ ok: true, weekEnding, review })
}
