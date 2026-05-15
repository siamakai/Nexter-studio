import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'
const SIAMAK_EMAILS = [
  (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase(),
  'siamak.goudarzi@nexterlaw.com',
]

// Window: 45–80 min from now — wide enough that no meeting falls through the 30-min cron gap
const WINDOW_MIN_MS = 45 * 60 * 1000
const WINDOW_MAX_MS = 80 * 60 * 1000

const SKIP_TITLE = /buffer|focus block|hold|placeholder|busy|ooo|out of office|no meeting/i

interface PrepMeeting {
  title:       string
  startAt:     Date
  platform:    'Zoom' | 'Google Meet' | 'Unknown'
  meetLink:    string
  isHost:      boolean
  attendees:   string[]
  source:      'google' | 'outlook'
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
      const isZoom      = description.includes('zoom.us') || location.includes('zoom.us')
      const isMeet      = !!(ev.hangoutLink || ev.conferenceData)
      const platform    = isZoom ? 'Zoom' : isMeet ? 'Google Meet' : 'Unknown'
      const meetLink    = ev.hangoutLink || (isZoom ? (description.match(/https?:\/\/[^\s]*zoom\.us[^\s]*/)?.[0] || location) : '') || ''

      const organizerEmail = (ev.organizer?.email || '').toLowerCase()
      const isHost = SIAMAK_EMAILS.some(e => organizerEmail === e || organizerEmail.includes(e.split('@')[0]))

      const attendees = (ev.attendees || [])
        .filter(a => !a.self && !a.email?.includes('resource.calendar.google'))
        .map(a => a.email ?? '')
        .filter(Boolean)

      meetings.push({
        title,
        startAt: new Date(ev.start?.dateTime || ev.start?.date || ''),
        platform,
        meetLink,
        isHost,
        attendees,
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
      const bodyPrev = (ev.bodyPreview as string)            || ''
      const loc      = (ev.location?.displayName as string)  || ''
      const isZoom   = joinUrl.includes('zoom.us') || bodyPrev.includes('zoom.us') || loc.includes('zoom.us')
      const platform = isZoom ? 'Zoom' : 'Unknown'
      if (platform === 'Unknown') continue  // skip Teams/phone/in-person for now

      const organizerEmail = (ev.organizer?.emailAddress?.address as string || '').toLowerCase()
      const isHost = SIAMAK_EMAILS.some(e => organizerEmail === e || organizerEmail.includes(e.split('@')[0]))

      const attendees = ((ev.attendees || []) as Record<string, Record<string, string>>[])
        .map(a => a.emailAddress?.address || '')
        .filter(e => e && !SIAMAK_EMAILS.some(se => e.toLowerCase() === se))

      meetings.push({
        title,
        startAt: new Date((ev.start?.dateTime as string) + 'Z'),
        platform,
        meetLink: joinUrl,
        isHost,
        attendees,
        source: 'outlook',
      })
    }
    return meetings
  } catch (err) {
    console.error('[meeting-prep] Outlook Calendar error:', err)
    return []
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now         = Date.now()
  const windowStart = new Date(now + WINDOW_MIN_MS)
  const windowEnd   = new Date(now + WINDOW_MAX_MS)

  // Fetch from both calendars in parallel
  const [googleMeetings, outlookMeetings] = await Promise.all([
    getGoogleMeetings(windowStart, windowEnd),
    getOutlookMeetings(windowStart, windowEnd),
  ])

  // Merge and deduplicate by title + start time
  const seen = new Set<string>()
  const allMeetings: PrepMeeting[] = []
  for (const m of [...googleMeetings, ...outlookMeetings]) {
    const key = `${m.title.toLowerCase().trim()}|${m.startAt.toISOString().slice(0, 16)}`
    if (!seen.has(key)) { seen.add(key); allMeetings.push(m) }
  }

  if (!allMeetings.length) {
    return NextResponse.json({ ok: true, message: 'No meetings in the next 45–80 minutes', sources: { google: googleMeetings.length, outlook: outlookMeetings.length } })
  }

  // Dedup — skip if prep email already sent today for this meeting
  const sentToday = new Set<string>()
  try {
    const auth  = await getAuthedClient()
    const gmail = google.gmail({ version: 'v1', auth })
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const { data: sentData } = await gmail.users.messages.list({
      userId: 'me',
      q: `subject:"Meeting in 1hr" after:${todayStr}`,
      maxResults: 20,
    })
    for (const msg of sentData.messages || []) {
      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['Subject'] })
      const subject = full.payload?.headers?.find(h => h.name === 'Subject')?.value || ''
      sentToday.add(subject)
    }
  } catch { /* skip dedup if Gmail unavailable */ }

  const logs: string[] = []
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  for (const meeting of allMeetings) {
    const startTime = meeting.startAt.toLocaleString('en-GB', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const expectedSubject = `Meeting in 1hr: ${meeting.title} (${startTime})`
    if (sentToday.has(expectedSubject)) {
      logs.push(`⏭ Already sent prep for: ${meeting.title}`)
      continue
    }

    const contextLines: string[] = [`Source calendar: ${meeting.source === 'outlook' ? 'Outlook (nexterlaw.com)' : 'Google'}`]

    // CRM lookup per attendee
    for (const email of meeting.attendees.slice(0, 3)) {
      if (process.env.GHL_API_KEY) {
        try {
          const res = await fetch(
            `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
            { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
          )
          const data = await res.json()
          const c = data.contacts?.[0]
          if (c) contextLines.push(`CRM — ${c.firstName || ''} ${c.lastName || ''} | ${c.companyName || 'no company'} | Tags: ${(c.tags || []).join(', ') || 'none'}`)
        } catch { /* skip */ }
      }

      // Last Gmail thread with this person
      try {
        const auth  = await getAuthedClient()
        const gmail = google.gmail({ version: 'v1', auth })
        const { data } = await gmail.users.messages.list({ userId: 'me', q: `from:${email} OR to:${email}`, maxResults: 1 })
        if (data.messages?.length) {
          const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: data.messages[0].id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })
          const get = (n: string) => msg.payload?.headers?.find(h => h.name === n)?.value || ''
          contextLines.push(`Last email — "${get('Subject')}" on ${get('Date')}`)
        }
      } catch { /* skip */ }
    }

    const brief = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write a 1-hour pre-meeting brief for Dr. Siamak Goudarzi.

Meeting: ${meeting.title}
Starts at: ${startTime}
Platform: ${meeting.platform}${meeting.meetLink ? ` — ${meeting.meetLink}` : ''}
Role: ${meeting.isHost ? 'HOST (you organised this meeting)' : 'ATTENDEE (someone else organised this)'}
Attendees: ${meeting.attendees.join(', ') || 'Not specified'}

Context:
${contextLines.join('\n') || 'No prior history found for these contacts.'}

Write 3–5 bullet points covering: who they are, what to remember, what to achieve, and one sharp question to open with.
Plain text only. Be concise and sharp.`,
      }],
    })

    const briefText = (brief.content[0] as { type: 'text'; text: string }).text

    // Platform + role action note
    let platformNote = ''
    const { platform, isHost, meetLink } = meeting
    if (platform === 'Google Meet' && isHost) {
      platformNote = '\n\n⚠️ GOOGLE MEET — You are the host. When the call starts, click ⋮ → "Transcribe meeting" → Start. Required for the automatic post-meeting summary.'
    } else if (platform === 'Google Meet' && !isHost) {
      platformNote = '\n\n📋 GOOGLE MEET — You are an attendee (not the host). After the call, go to va.nexterai.agency and share your notes so a report can be generated.'
    } else if (platform === 'Zoom' && isHost) {
      platformNote = '\n\n✅ ZOOM — You are the host. Cloud recording is on — the meeting will be transcribed and summarised automatically after it ends.'
    } else if (platform === 'Zoom' && !isHost) {
      platformNote = '\n\n📋 ZOOM — You are an attendee (not the host). Recording depends on the host\'s settings. After the call, go to va.nexterai.agency if you want to save your notes.'
    }

    // Send prep email
    try {
      const auth  = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to      = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const subject = `Meeting in 1hr: ${meeting.title} (${startTime})`
      const body    = `${briefText}${platformNote}`
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n')
      ).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      logs.push(`✓ Prep sent [${meeting.source}]: ${meeting.title} | ${platform} | ${isHost ? 'HOST' : 'ATTENDEE'}`)
    } catch (err) {
      logs.push(`✗ Email error for "${meeting.title}": ${String(err)}`)
    }
  }

  return NextResponse.json({ ok: true, google: googleMeetings.length, outlook: outlookMeetings.length, logs })
}
