import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'
const SIAMAK_EMAILS = [
  (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase(),
  'siamak.goudarzi@nexterlaw.com',
]

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, message: 'Google Calendar not connected' })
  }

  // Find meetings starting in 55–65 minutes (1 hour before)
  const now = Date.now()
  const windowStart = new Date(now + 55 * 60 * 1000)
  const windowEnd   = new Date(now + 65 * 60 * 1000)

  let upcomingEvents: Record<string, unknown>[] = []
  try {
    const auth = await getAuthedClient()
    const cal = google.calendar({ version: 'v3', auth })
    const { data } = await cal.events.list({
      calendarId: 'primary',
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
    })
    upcomingEvents = (data.items || []) as Record<string, unknown>[]
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) })
  }

  if (!upcomingEvents.length) {
    return NextResponse.json({ ok: true, message: 'No meetings in 1 hour' })
  }

  // Dedup — skip if prep email already sent today for this meeting
  const sentToday = new Set<string>()
  try {
    const auth = await getAuthedClient()
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
  } catch { /* skip dedup check if Gmail unavailable */ }

  const logs: string[] = []
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  for (const event of upcomingEvents) {
    const title = event.summary as string || 'Meeting'
    const attendees = ((event.attendees as { email: string; self?: boolean }[]) || [])
      .filter(a => !a.self)
      .map(a => a.email)
      .filter(e => !e.includes('resource.calendar.google'))

    const startTime = new Date((event.start as Record<string, string>)?.dateTime || '').toLocaleString('en-GB', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    })

    const expectedSubject = `Meeting in 1hr: ${title} (${startTime})`
    if (sentToday.has(expectedSubject)) {
      logs.push(`⏭ Already sent prep for: ${title}`)
      continue
    }

    // Detect platform
    const description = (event.description as string) || ''
    const location    = (event.location as string) || ''
    const isZoom      = description.includes('zoom.us') || location.includes('zoom.us')
    const isMeet      = !!(event.hangoutLink || (event as Record<string, unknown>).conferenceData)
    const platform    = isZoom ? 'Zoom' : isMeet ? 'Google Meet' : 'Unknown platform'
    const meetLink    = (event.hangoutLink as string) || (isZoom ? (description.match(/https?:\/\/[^\s]*zoom\.us[^\s]*/)?.[0] || location) : '')

    // Detect host
    const organizerEmail = ((event.organizer as Record<string, string>)?.email || '').toLowerCase()
    const isHost = SIAMAK_EMAILS.some(e => organizerEmail === e || organizerEmail.includes(e.split('@')[0]))

    const contextLines: string[] = []

    // CRM lookup per attendee
    for (const email of attendees.slice(0, 3)) {
      if (process.env.GHL_API_KEY) {
        try {
          const res = await fetch(
            `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
            { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
          )
          const data = await res.json()
          const c = data.contacts?.[0]
          if (c) {
            contextLines.push(`CRM — ${c.firstName || ''} ${c.lastName || ''} | ${c.companyName || 'no company'} | Tags: ${(c.tags || []).join(', ') || 'none'}`)
          }
        } catch { /* skip */ }
      }

      // Last Gmail thread with this person
      try {
        const auth = await getAuthedClient()
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

Meeting: ${title}
Starts at: ${startTime}
Platform: ${platform}${meetLink ? ` — ${meetLink}` : ''}
Role: ${isHost ? 'HOST (you organised this meeting)' : 'ATTENDEE (someone else organised this)'}
Attendees: ${attendees.join(', ') || 'Not specified'}

Context:
${contextLines.join('\n') || 'No prior history found for these contacts.'}

Write 3–5 bullet points covering: who they are, what to remember, what to achieve, and one sharp question to open with.
Plain text only. Be concise and sharp.`,
      }],
    })

    const briefText = (brief.content[0] as { type: 'text'; text: string }).text

    // Build platform-specific action line
    let platformNote = ''
    if (isMeet && isHost) {
      platformNote = '\n\n⚠️ GOOGLE MEET — You are the host. When the call starts, click the three-dot menu (⋮) → "Transcribe meeting" → Start. This is required for the automatic post-meeting summary.'
    } else if (isMeet && !isHost) {
      platformNote = '\n\n📋 GOOGLE MEET — You are an attendee (not the host). The meeting may not be recorded. After the call, go to va.nexterai.agency and share your notes so a report can be generated.'
    } else if (isZoom && isHost) {
      platformNote = '\n\n✅ ZOOM — You are the host. Cloud recording is on — the meeting will be transcribed and summarised automatically after it ends.'
    } else if (isZoom && !isHost) {
      platformNote = '\n\n📋 ZOOM — You are an attendee (not the host). Recording depends on the host\'s settings. After the call, go to va.nexterai.agency if you want to save your notes.'
    }

    // Send prep email
    try {
      const auth = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const subject = `Meeting in 1hr: ${title} (${startTime})`
      const body = `${briefText}${platformNote}`
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n')
      ).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      logs.push(`✓ Prep sent: ${title} | ${platform} | ${isHost ? 'HOST' : 'ATTENDEE'}`)
    } catch (err) {
      logs.push(`✗ Email error for "${title}": ${String(err)}`)
    }
  }

  return NextResponse.json({ ok: true, logs })
}
