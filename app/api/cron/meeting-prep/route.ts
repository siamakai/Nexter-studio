import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'
import { getRecentMeetings, getTasks } from '@/lib/supabase'

export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'
const SIAMAK_EMAILS = [
  (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase(),
  'siamak.goudarzi@nexterlaw.com',
]

// Wide window: 30–120 min before meeting start.
// Deduplication (sent email subject check) prevents double-sending.
// This ensures no meeting is ever missed — even if one cron run fails,
// the next run (30 min later) still catches meetings in the 60–120 min range.
const WINDOW_MIN_MS =  30 * 60 * 1000
const WINDOW_MAX_MS = 120 * 60 * 1000

const SKIP_TITLE = /buffer|focus block|hold|placeholder|busy|ooo|out of office|no meeting/i

interface PrepMeeting {
  title:         string
  startAt:       Date
  platform:      'Zoom' | 'Google Meet' | 'Unknown'
  meetLink:      string
  isHost:        boolean
  attendees:     string[]   // external emails only
  attendeeNames: string[]
  source:        'google' | 'outlook'
}

// ── Google Calendar ───────────────────────────────────────────────────────────

async function getGoogleMeetings(windowStart: Date, windowEnd: Date): Promise<PrepMeeting[]> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return []
  try {
    const auth = await getAuthedClient()
    const cal  = google.calendar({ version: 'v3', auth })
    const { data } = await cal.events.list({
      calendarId: 'primary',
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
    })

    const meetings: PrepMeeting[] = []
    for (const ev of data.items || []) {
      const title = (ev.summary || 'Meeting') as string
      if (SKIP_TITLE.test(title)) continue

      const description = ev.description || ''
      const location    = ev.location    || ''
      const isZoom  = description.includes('zoom.us') || location.includes('zoom.us')
      const isMeet  = !!(ev.hangoutLink || ev.conferenceData)
      const platform = isZoom ? 'Zoom' : isMeet ? 'Google Meet' : 'Unknown'
      if (platform === 'Unknown') continue

      const meetLink = ev.hangoutLink ||
        (isZoom ? (description.match(/https?:\/\/[^\s]*zoom\.us[^\s]*/)?.[0] || location) : '') || ''

      const organizerEmail = (ev.organizer?.email || '').toLowerCase()
      const isHost = SIAMAK_EMAILS.some(e =>
        organizerEmail === e || organizerEmail.includes(e.split('@')[0])
      )

      const rawAttendees = (ev.attendees || [])
        .filter(a => !a.self && !a.email?.includes('resource.calendar.google'))
      const attendees     = rawAttendees.map(a => a.email ?? '').filter(Boolean)
      const attendeeNames = rawAttendees.map(a => a.displayName || a.email || '').filter(Boolean)

      meetings.push({
        title,
        startAt: new Date(ev.start?.dateTime || ev.start?.date || ''),
        platform, meetLink, isHost, attendees, attendeeNames,
        source: 'google',
      })
    }
    return meetings
  } catch (err) {
    console.error('[meeting-prep] Google Calendar error:', err)
    return []
  }
}

// ── Outlook Calendar ──────────────────────────────────────────────────────────

async function getOutlookMeetings(windowStart: Date, windowEnd: Date): Promise<PrepMeeting[]> {
  if (!process.env.MS_REFRESH_TOKEN) return []
  const OUTLOOK_EMAIL = 'siamak.goudarzi@nexterlaw.com'
  try {
    const token = await getMsAccessToken(OUTLOOK_EMAIL)
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView` +
      `?startDateTime=${windowStart.toISOString()}&endDateTime=${windowEnd.toISOString()}` +
      `&$select=subject,start,organizer,attendees,onlineMeeting,location,bodyPreview&$top=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return []
    const data = await res.json()

    const meetings: PrepMeeting[] = []
    for (const ev of (data.value || [])) {
      const title = (ev.subject || 'Meeting') as string
      if (SKIP_TITLE.test(title)) continue

      const joinUrl  = (ev.onlineMeeting?.joinUrl as string) || ''
      const bodyPrev = (ev.bodyPreview as string) || ''
      const loc      = (ev.location?.displayName as string) || ''

      const isZoom = joinUrl.includes('zoom.us') || bodyPrev.includes('zoom.us') || loc.includes('zoom.us')
      const isMeet = bodyPrev.includes('meet.google.com') || loc.includes('meet.google.com')
      const platform = isZoom ? 'Zoom' : isMeet ? 'Google Meet' : 'Unknown'
      if (platform === 'Unknown') continue

      const organizerEmail = (ev.organizer?.emailAddress?.address as string || '').toLowerCase()
      const isHost = SIAMAK_EMAILS.some(e =>
        organizerEmail === e || organizerEmail.includes(e.split('@')[0])
      )

      const rawAttendees = (ev.attendees || []) as Record<string, Record<string, string>>[]
      const attendees = rawAttendees
        .map(a => a.emailAddress?.address || '')
        .filter(e => e && !SIAMAK_EMAILS.some(se => e.toLowerCase() === se))
      const attendeeNames = rawAttendees
        .map(a => a.emailAddress?.name || a.emailAddress?.address || '')
        .filter(Boolean)

      meetings.push({
        title,
        startAt: new Date((ev.start?.dateTime as string) + 'Z'),
        platform, meetLink: joinUrl, isHost, attendees, attendeeNames,
        source: 'outlook',
      })
    }
    return meetings
  } catch (err) {
    console.error('[meeting-prep] Outlook Calendar error:', err)
    return []
  }
}

// ── Per-attendee context builder ──────────────────────────────────────────────

interface AttendeeContext {
  email:            string
  crmName:          string
  crmCompany:       string
  crmSource:        string
  crmTags:          string[]
  previousMeetings: string   // from Supabase meeting_reports
  openTasks:        string   // from Supabase tasks
  lastEmailGmail:   string   // subject + date from Gmail
  lastEmailOutlook: string   // subject + date from Outlook
  driveFiles:       string   // related Drive docs
}

async function buildAttendeeContext(
  email: string,
  gmail: ReturnType<typeof google.gmail>,
  drive: ReturnType<typeof google.drive>,
): Promise<AttendeeContext> {
  const ctx: AttendeeContext = {
    email,
    crmName: '', crmCompany: '', crmSource: '', crmTags: [],
    previousMeetings: '', openTasks: '',
    lastEmailGmail: '', lastEmailOutlook: '', driveFiles: '',
  }

  await Promise.all([

    // 1. CRM — name, company, source, tags
    (async () => {
      if (!process.env.GHL_API_KEY) return
      try {
        const res = await fetch(
          `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
          { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
        )
        const data = await res.json()
        const c = data.contacts?.[0]
        if (c) {
          ctx.crmName    = `${c.firstName || ''} ${c.lastName || ''}`.trim()
          ctx.crmCompany = c.companyName || ''
          ctx.crmSource  = c.source || ''
          ctx.crmTags    = c.tags || []
        }
      } catch { /* skip */ }
    })(),

    // 2. Previous meetings from Supabase (last 6 months)
    (async () => {
      try {
        const all = await getRecentMeetings(180)
        const relevant = all.filter(m =>
          m.contact_email?.toLowerCase() === email.toLowerCase() ||
          m.attendees?.toLowerCase().includes(email.split('@')[0].toLowerCase())
        ).slice(0, 3)
        if (relevant.length) {
          ctx.previousMeetings = relevant.map(m =>
            `• ${m.date} — ${m.title}: ${m.summary.slice(0, 180)}...`
          ).join('\n')
        }
      } catch { /* skip */ }
    })(),

    // 3. Open tasks linked to this contact
    (async () => {
      try {
        const all = await getTasks(false)
        const nameKey = email.split('@')[0].toLowerCase().replace(/[._]/g, ' ')
        const relevant = all.filter(t =>
          t.contact_name?.toLowerCase().includes(nameKey) ||
          t.content.toLowerCase().includes(nameKey)
        ).slice(0, 5)
        if (relevant.length) {
          ctx.openTasks = relevant.map(t =>
            `• ${t.content}${t.due_date ? ` — due ${t.due_date}` : ''}${t.due_date && new Date(t.due_date) < new Date() ? ' ⚠️ OVERDUE' : ''}`
          ).join('\n')
        }
      } catch { /* skip */ }
    })(),

    // 4. Last email — Gmail (both info and nexterlaw via unified search)
    (async () => {
      try {
        const { data } = await gmail.users.messages.list({
          userId: 'me',
          q: `from:${email} OR to:${email}`,
          maxResults: 1,
        })
        if (data.messages?.length) {
          const { data: msg } = await gmail.users.messages.get({
            userId: 'me', id: data.messages[0].id!,
            format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'],
          })
          const get = (n: string) => msg.payload?.headers?.find(h => h.name === n)?.value || ''
          ctx.lastEmailGmail = `"${get('Subject')}" — ${get('Date')}`
        }
      } catch { /* skip */ }
    })(),

    // 5. Last email — Outlook (nexterlaw.com)
    (async () => {
      if (!process.env.MS_REFRESH_TOKEN) return
      try {
        const token = await getMsAccessToken('siamak.goudarzi@nexterlaw.com')
        // Search inbox for messages from this person
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages` +
          `?$search="from:${email}"` +
          `&$select=subject,receivedDateTime&$top=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (res.ok) {
          const data = await res.json()
          const msg = data.value?.[0]
          if (msg) {
            ctx.lastEmailOutlook = `"${msg.subject}" — ${new Date(msg.receivedDateTime).toDateString()}`
          }
        }
      } catch { /* skip */ }
    })(),

    // 6. Related Drive files (by email username or company keyword)
    (async () => {
      try {
        const nameKey = email.split('@')[0].replace(/[._-]/g, ' ')
        const { data } = await drive.files.list({
          q: `name contains '${nameKey}' and trashed = false`,
          fields: 'files(id, name, webViewLink, modifiedTime)',
          pageSize: 3,
          orderBy: 'modifiedTime desc',
        })
        if (data.files?.length) {
          ctx.driveFiles = data.files.map(f =>
            `• ${f.name} → ${f.webViewLink}`
          ).join('\n')
        }
      } catch { /* skip */ }
    })(),

  ])

  return ctx
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now         = Date.now()
  const windowStart = new Date(now + WINDOW_MIN_MS)
  const windowEnd   = new Date(now + WINDOW_MAX_MS)

  // Fetch both calendars in parallel
  const [googleMeetings, outlookMeetings] = await Promise.all([
    getGoogleMeetings(windowStart, windowEnd),
    getOutlookMeetings(windowStart, windowEnd),
  ])

  // Merge and deduplicate by title + start time (same meeting in both calendars)
  const seen = new Set<string>()
  const allMeetings: PrepMeeting[] = []
  for (const m of [...googleMeetings, ...outlookMeetings]) {
    const key = `${m.title.toLowerCase().trim()}|${m.startAt.toISOString().slice(0, 16)}`
    if (!seen.has(key)) { seen.add(key); allMeetings.push(m) }
  }

  if (!allMeetings.length) {
    return NextResponse.json({
      ok: true,
      message: 'No meetings in the next 30–120 minutes',
      sources: { google: googleMeetings.length, outlook: outlookMeetings.length },
    })
  }

  // Check which meetings already have a prep email sent today
  const sentToday = new Set<string>()
  const auth  = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const drive = google.drive({ version: 'v3', auth })

  try {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const { data: sentData } = await gmail.users.messages.list({
      userId: 'me',
      q: `subject:"Meeting Prep:" after:${todayStr}`,
      maxResults: 20,
    })
    for (const msg of sentData.messages || []) {
      const { data: full } = await gmail.users.messages.get({
        userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['Subject'],
      })
      const subject = full.payload?.headers?.find(h => h.name === 'Subject')?.value || ''
      sentToday.add(subject)
    }
  } catch { /* skip dedup if Gmail unavailable */ }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const logs: string[] = []

  for (const meeting of allMeetings) {
    const startTime = meeting.startAt.toLocaleString('en-GB', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const startFull = meeting.startAt.toLocaleString('en-GB', {
      timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
      year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const minUntil = Math.round((meeting.startAt.getTime() - now) / 60000)
    const subject  = `Meeting Prep: ${meeting.title} (${startTime})`

    if (sentToday.has(subject)) {
      logs.push(`⏭ Already sent prep for: ${meeting.title}`)
      continue
    }

    // Build context for all attendees in parallel
    const attendeeContexts = await Promise.all(
      meeting.attendees.slice(0, 3).map(email => buildAttendeeContext(email, gmail, drive))
    )

    const isFirstMeeting = attendeeContexts.every(ctx => !ctx.previousMeetings)

    // Build context block for Claude
    const contextBlocks = attendeeContexts.map(ctx => {
      const lines: string[] = []
      lines.push(`Email: ${ctx.email}`)
      if (ctx.crmName)    lines.push(`Name: ${ctx.crmName}`)
      if (ctx.crmCompany) lines.push(`Company: ${ctx.crmCompany}`)
      if (ctx.crmSource)  lines.push(`Lead source: ${ctx.crmSource}`)
      if (ctx.crmTags.length) lines.push(`CRM tags: ${ctx.crmTags.join(', ')}`)
      if (ctx.previousMeetings) lines.push(`Previous meetings:\n${ctx.previousMeetings}`)
      else lines.push('Previous meetings: none (first meeting)')
      if (ctx.openTasks)        lines.push(`Open tasks:\n${ctx.openTasks}`)
      if (ctx.lastEmailGmail)   lines.push(`Last Gmail: ${ctx.lastEmailGmail}`)
      if (ctx.lastEmailOutlook) lines.push(`Last Outlook: ${ctx.lastEmailOutlook}`)
      return lines.join('\n')
    })

    // Claude brief
    const brief = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Write a sharp pre-meeting brief for Dr. Siamak Goudarzi, Founder of Nexter AI Group (AI implementation agency for businesses).

Meeting: ${meeting.title}
Starts: ${startFull} (in ${minUntil} minutes)
Platform: ${meeting.platform}${meeting.meetLink ? ` — ${meeting.meetLink}` : ''}
Your role: ${meeting.isHost ? 'HOST — you organised this meeting' : 'ATTENDEE — someone else organised this'}
Calendar: ${meeting.source === 'outlook' ? 'Outlook (nexterlaw.com)' : 'Google Calendar'}

ATTENDEE CONTEXT:
${contextBlocks.join('\n\n---\n') || 'No CRM data found.'}

Write exactly these four sections (plain text, no markdown symbols):

WHO THEY ARE
One or two sentences: who this person is, their company, why they are in the pipeline, and how they first found us. If first meeting, say so clearly.

WHAT TO REMEMBER
Up to 3 bullet points: key context from previous conversations, outstanding tasks or follow-ups, anything unresolved.

WHAT TO ACHIEVE TODAY
Up to 3 bullet points: concrete objectives for this specific meeting. Be specific — not generic goals.

ONE SHARP OPENING QUESTION
A single focused question to open the meeting with. Make it specific to this person and situation.

Be direct and sharp. No filler. No generic advice.`,
      }],
    })

    const briefText = (brief.content[0] as { type: 'text'; text: string }).text

    // Platform + role action note — clear and direct
    let actionNote = ''
    if (meeting.platform === 'Google Meet' && meeting.isHost) {
      actionNote =
        '⚠️  ACTION REQUIRED — GOOGLE MEET HOST\n' +
        'When the call starts: click "Activities" (bottom-right corner) → "Transcription" → "Start transcription"\n' +
        'This is required. Without it the post-meeting summary cannot be generated automatically.'
    } else if (meeting.platform === 'Google Meet' && !meeting.isHost) {
      actionNote =
        '📋  GOOGLE MEET — YOU ARE THE ATTENDEE\n' +
        'You did not organise this meeting. Transcription is NOT under your control.\n' +
        'After the call: go to va.nexterai.agency → submit your notes → the system will generate and save the report.\n' +
        'Without your notes, only calendar data will be used.'
    } else if (meeting.platform === 'Zoom' && meeting.isHost) {
      actionNote =
        '✅  ZOOM — YOU ARE THE HOST\n' +
        'Cloud recording is enabled on your account. A transcript and full summary will arrive automatically within 30–60 minutes after the meeting ends.\n' +
        'No action needed during the call.'
    } else if (meeting.platform === 'Zoom' && !meeting.isHost) {
      actionNote =
        '⚠️  ZOOM — YOU ARE THE ATTENDEE\n' +
        'Recording and transcript depend on the host\'s Zoom settings — you may not have access.\n' +
        'After the call: go to va.nexterai.agency → submit your notes immediately → the system will save the full report to Drive and update the CRM.'
    }

    // Attendee summary lines for the email header
    const attendeeLines = attendeeContexts.map(ctx => {
      const parts: string[] = [ctx.crmName || ctx.email]
      if (ctx.crmCompany) parts.push(ctx.crmCompany)
      if (ctx.crmSource)  parts.push(`via ${ctx.crmSource}`)
      if (ctx.crmTags.length) parts.push(`[${ctx.crmTags.slice(0, 4).join(', ')}]`)
      return parts.join(' | ')
    })

    const allDriveFiles = attendeeContexts
      .filter(ctx => ctx.driveFiles)
      .map(ctx => ctx.driveFiles)
      .join('\n')

    const allOpenTasks = attendeeContexts
      .filter(ctx => ctx.openTasks)
      .map(ctx => ctx.openTasks)
      .join('\n')

    // Build the email body
    const separator = '────────────────────────────────────'
    const emailLines: string[] = [
      `📅  ${meeting.title}`,
      `    ${startFull}`,
      `    Platform: ${meeting.platform} | Role: ${meeting.isHost ? 'HOST' : 'ATTENDEE'} | Calendar: ${meeting.source === 'outlook' ? 'Outlook' : 'Google'}`,
      meeting.meetLink ? `    Join: ${meeting.meetLink}` : '',
      '',
      separator,
      actionNote,
      separator,
      '',
      'ATTENDEES',
      ...attendeeLines,
      '',
      allOpenTasks ? `OPEN TASKS FROM PREVIOUS MEETINGS\n${allOpenTasks}\n` : '',
      allDriveFiles ? `RELATED DRIVE FILES\n${allDriveFiles}\n` : '',
      separator,
      '',
      briefText,
    ].filter(l => l !== null && l !== undefined)

    const emailBody = emailLines.join('\n')

    // Send
    try {
      const to  = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const raw = Buffer.from([
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        emailBody,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      logs.push(`✓ Prep [${meeting.source}]: ${meeting.title} | ${meeting.platform} | ${meeting.isHost ? 'HOST' : 'ATTENDEE'} | in ${minUntil}min`)
    } catch (err) {
      logs.push(`✗ Email error: "${meeting.title}" — ${String(err)}`)
    }
  }

  return NextResponse.json({ ok: true, google: googleMeetings.length, outlook: outlookMeetings.length, logs })
}
