/**
 * Unified Post-Meeting Processor — runs every hour
 *
 * S1 — Zoom + host:     Zoom webhook at /api/webhooks/zoom is primary.
 *                        Cron waits 60 min after meeting end; if no webhook report was
 *                        sent yet, generates a calendar-data fallback with yellow banner.
 *
 * S2 — Google Meet + host:  Calendar-data summary immediately → Drive → CRM → follow-up draft
 *                             → email with BLUE banner "add your notes at va.nexterai.agency"
 *
 * S3 — Zoom + attendee:     Same as S2 (calendar data, blue banner).
 *
 * S4 — Google Meet + attendee: Same as S2 (calendar data, blue banner).
 *
 * Notes submitted later via VA → saved to Drive, no extra email.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'
import {
  generateMeetingSummary,
  saveMeetingToDrive,
  findGhlContact,
  addGhlNote,
  autoTagContact,
  buildMeetingEmailHtml,
  sendMeetingEmail,
  extractAndSaveTasks,
} from '@/lib/meeting-report'

export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://va.nexterai.agency'

const SIAMAK_EMAILS = [
  (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase(),
  'siamak.goudarzi@nexterlaw.com',
]

// Look back 4 hours — catches any meeting from earlier in the day. Dedup prevents duplicates.
const LOOK_BACK_MS = 4 * 60 * 60 * 1000
const GRACE_MS     = 15 * 60 * 1000

const SKIP_TITLE = /buffer|focus block|hold|placeholder|busy|ooo|out of office|no meeting/i

// ── Shared meeting structure ──────────────────────────────────────────────────

interface UnifiedMeeting {
  title:         string
  startAt:       Date
  endAt:         Date
  durationMin:   number
  platform:      'Zoom' | 'Google Meet' | 'Teams' | 'Unknown'
  isSiamakHost:  boolean
  organizer:     string
  attendees:     string[]
  attendeeNames: string[]
  meetLink:      string
  source:        'google' | 'outlook'
  calendarId?:   string
}

// ── Google Calendar ───────────────────────────────────────────────────────────

async function getGoogleMeetings(): Promise<UnifiedMeeting[]> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return []
  try {
    const auth = await getAuthedClient()
    const cal  = google.calendar({ version: 'v3', auth })
    const now  = Date.now()

    const { data } = await cal.events.list({
      calendarId: 'primary',
      timeMin: new Date(now - LOOK_BACK_MS).toISOString(),
      timeMax: new Date(now - GRACE_MS).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    })

    const meetings: UnifiedMeeting[] = []

    for (const ev of data.items || []) {
      const title = ev.summary || 'Meeting'
      if (SKIP_TITLE.test(title)) continue

      const startAt     = new Date(ev.start?.dateTime || ev.start?.date || now)
      const endAt       = new Date(ev.end?.dateTime   || ev.end?.date   || now)
      const durationMin = Math.round((endAt.getTime() - startAt.getTime()) / 60000)
      if (durationMin < 5) continue

      const desc     = ev.description || ''
      const location = ev.location    || ''
      const isZoom   = desc.includes('zoom.us') || location.includes('zoom.us')
      const isGMeet  = !!(ev.hangoutLink || ev.conferenceData)
      const platform = isZoom ? 'Zoom' : isGMeet ? 'Google Meet' : 'Unknown'
      if (platform === 'Unknown') continue

      const organizerEmail = (ev.organizer?.email || '').toLowerCase()
      const isSiamakHost   = SIAMAK_EMAILS.some(e =>
        organizerEmail === e || organizerEmail.includes(e.split('@')[0])
      )
      const organizer     = ev.organizer?.displayName || ev.organizer?.email || 'Unknown'
      const rawAttendees  = (ev.attendees || []).filter(a => !a.self && !a.resource)
      const attendees     = rawAttendees.map(a => a.email || '').filter(Boolean)
      const attendeeNames = rawAttendees.map(a => a.displayName || a.email || '').filter(Boolean)
      const meetLink      = ev.hangoutLink ||
        (isZoom ? (desc.match(/https?:\/\/[^\s]*zoom\.us[^\s]*/)?.[0] || location) : '') || ''

      meetings.push({
        title, startAt, endAt, durationMin, platform,
        isSiamakHost, organizer, attendees, attendeeNames, meetLink,
        source: 'google', calendarId: ev.id || undefined,
      })
    }

    return meetings
  } catch (err) {
    console.error('[post-meeting] Google Calendar error:', err)
    return []
  }
}

// ── Outlook Calendar ──────────────────────────────────────────────────────────

async function getOutlookMeetings(): Promise<UnifiedMeeting[]> {
  if (!process.env.MS_REFRESH_TOKEN) return []
  const OUTLOOK_EMAIL = 'siamak.goudarzi@nexterlaw.com'
  try {
    const token = await getMsAccessToken(OUTLOOK_EMAIL)
    const now   = Date.now()
    const start = new Date(now - LOOK_BACK_MS).toISOString()
    const end   = new Date(now - GRACE_MS).toISOString()

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView` +
      `?startDateTime=${start}&endDateTime=${end}` +
      `&$select=subject,start,end,organizer,attendees,onlineMeeting,location,bodyPreview` +
      `&$top=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return []
    const data = await res.json()

    const meetings: UnifiedMeeting[] = []

    for (const ev of (data.value || [])) {
      const title = (ev.subject || 'Meeting') as string
      if (SKIP_TITLE.test(title)) continue

      const startAt     = new Date(ev.start?.dateTime + 'Z')
      const endAt       = new Date(ev.end?.dateTime + 'Z')
      const durationMin = Math.round((endAt.getTime() - startAt.getTime()) / 60000)
      if (durationMin < 5) continue

      const joinUrl  = (ev.onlineMeeting?.joinUrl as string) || ''
      const bodyPrev = (ev.bodyPreview as string) || ''
      const loc      = (ev.location?.displayName as string) || ''
      const isZoom   = joinUrl.includes('zoom.us') || bodyPrev.includes('zoom.us') || loc.includes('zoom.us')
      const isMeet   = bodyPrev.includes('meet.google.com') || loc.includes('meet.google.com')
      const platform = isZoom ? 'Zoom' : isMeet ? 'Google Meet' : 'Unknown'
      if (platform === 'Unknown') continue

      const organizerEmail = (ev.organizer?.emailAddress?.address as string || '').toLowerCase()
      const isSiamakHost   = SIAMAK_EMAILS.some(e =>
        organizerEmail === e || organizerEmail.includes(e.split('@')[0])
      )
      const organizer = (ev.organizer?.emailAddress?.name as string) || organizerEmail

      const rawAttendees  = (ev.attendees || []) as Record<string, Record<string, string>>[]
      const attendees     = rawAttendees
        .map(a => (a.emailAddress?.address || '').toLowerCase())
        .filter(e => e && !SIAMAK_EMAILS.some(se => e === se))
      const attendeeNames = rawAttendees
        .map(a => a.emailAddress?.name || a.emailAddress?.address || '')
        .filter(Boolean)

      meetings.push({
        title, startAt, endAt, durationMin, platform,
        isSiamakHost, organizer, attendees, attendeeNames,
        meetLink: joinUrl, source: 'outlook',
      })
    }

    return meetings
  } catch (err) {
    console.error('[post-meeting] Outlook Calendar error:', err)
    return []
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────────
// Checks for both cron reports ("Meeting Report:") and webhook reports ("Zoom Summary:")

async function getAlreadyProcessedToday(gmail: ReturnType<typeof google.gmail>): Promise<Set<string>> {
  const processed = new Set<string>()
  try {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: `(subject:"Meeting Report:" OR subject:"Zoom Summary:") after:${todayStr}`,
      maxResults: 30,
    })
    for (const msg of data.messages || []) {
      const { data: full } = await gmail.users.messages.get({
        userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['Subject'],
      })
      const subject = full.payload?.headers?.find(h => h.name === 'Subject')?.value || ''
      const match   = subject.match(/(?:Meeting Report:|Zoom Summary:)\s*(.+?)\s*(?:—|$)/)
      if (match) processed.add(match[1].toLowerCase().trim())
    }
  } catch { /* skip */ }
  return processed
}

// ── Follow-up draft ───────────────────────────────────────────────────────────

async function generateFollowUpDraft(anthropic: Anthropic, meeting: UnifiedMeeting, summary: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a brief, professional follow-up email from Dr. Siamak Goudarzi (Founder, Nexter AI Group) after this meeting.

Meeting: ${meeting.title}
Date: ${meeting.startAt.toLocaleString('en-GB', { timeZone: TZ })}
Duration: ${meeting.durationMin} minutes
Attendees: ${meeting.attendeeNames.join(', ') || meeting.attendees.join(', ') || 'Unknown'}

Meeting summary:
${summary.slice(0, 600)}

Write only the email body (no subject). 3–5 sentences. Reference key outcomes or next steps. Warm and professional. Sign off as Siamak.`,
    }],
  })
  return (res.content[0] as { type: 'text'; text: string }).text.trim()
}

async function createFollowUpDraft(
  gmail: ReturnType<typeof google.gmail>,
  meeting: UnifiedMeeting,
  followUpBody: string,
): Promise<boolean> {
  const primaryEmail = meeting.attendees[0] || meeting.organizer
  if (!primaryEmail || !primaryEmail.includes('@')) return false
  try {
    const raw = Buffer.from([
      `To: ${primaryEmail}`,
      `Subject: Follow-up: ${meeting.title}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      followUpBody,
    ].join('\r\n')).toString('base64url')
    await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } })
    return true
  } catch {
    return false
  }
}

// ── Shared report builder ─────────────────────────────────────────────────────

async function buildAndSendReport(
  meeting: UnifiedMeeting,
  gmail: ReturnType<typeof google.gmail>,
  anthropic: Anthropic,
  bannerHtml: string,
  transcriptSource: string,
  datePrefix: string,
  startFormatted: string,
): Promise<string> {
  const contextNote = [
    `Platform: ${meeting.platform}`,
    `Role: ${meeting.isSiamakHost ? 'Host' : 'Attendee'}`,
    `Organised by: ${meeting.organizer}`,
    meeting.attendeeNames.length ? `Attendees: ${meeting.attendeeNames.join(', ')}` : '',
    `Duration: ${meeting.durationMin} minutes`,
    `Note: ${transcriptSource}`,
  ].filter(Boolean).join('\n')

  const summary = await generateMeetingSummary(
    meeting.title, startFormatted, contextNote, meeting.durationMin
  )

  // Extract action items from summary and save as tasks
  extractAndSaveTasks(summary, meeting.title, datePrefix).catch(() => null)

  const fileContent = [
    `# ${meeting.title}`,
    `Date: ${startFormatted}`,
    `Duration: ${meeting.durationMin} min`,
    `Platform: ${meeting.platform}`,
    `Role: ${meeting.isSiamakHost ? 'Host' : 'Attendee'}`,
    `Source: ${transcriptSource}`,
    `Organised by: ${meeting.organizer}`,
    meeting.attendeeNames.length ? `Attendees: ${meeting.attendeeNames.join(', ')}` : '',
    '',
    summary,
    '',
    '---',
    '*Summary generated from calendar data — add your notes at va.nexterai.agency to enrich*',
  ].filter(l => l !== undefined).join('\n')

  const driveUrl = await saveMeetingToDrive(meeting.title, fileContent, datePrefix).catch(() => null)

  // CRM update
  let contact = null
  for (const email of meeting.attendees) {
    contact = await findGhlContact(email).catch(() => null)
    if (contact) break
  }
  if (!contact) {
    contact = await findGhlContact(meeting.title.split(/\s+/).slice(0, 3).join(' ')).catch(() => null)
  }
  if (contact) {
    const role = meeting.isSiamakHost ? 'HOST' : 'ATTENDEE'
    await addGhlNote(
      contact.id,
      `${meeting.platform.toUpperCase()} [${role}] — ${startFormatted}\nTopic: ${meeting.title}\nDuration: ${meeting.durationMin} min\n\n${summary}`
    ).catch(() => null)
    await autoTagContact(contact.id, summary, meeting.title).catch(() => null)
  }

  // Follow-up draft
  let followUpCreated = false
  try {
    const followUpText = await generateFollowUpDraft(anthropic, meeting, summary)
    followUpCreated = await createFollowUpDraft(gmail, meeting, followUpText)
  } catch { /* non-fatal */ }

  // Send briefing email
  const reportSubject = `Meeting Report: ${meeting.title} — ${datePrefix}`
  const html = buildMeetingEmailHtml({
    title: meeting.title,
    date: startFormatted,
    source: meeting.platform as 'Zoom' | 'Google Meet',
    summary: bannerHtml + summary,
    driveUrl,
    contactName: contact?.name || null,
    durationMin: meeting.durationMin,
  })
  await sendMeetingEmail(reportSubject, html)

  return `✓ ${meeting.title} | ${meeting.platform} | ${meeting.isSiamakHost ? 'host' : 'attendee'} | ${transcriptSource} | Drive: ${driveUrl ? 'saved' : 'failed'} | CRM: ${contact ? contact.name : 'not found'} | Follow-up: ${followUpCreated ? 'drafted' : 'skipped'}`
}

// ── Process a single meeting ──────────────────────────────────────────────────

async function processMeeting(
  meeting: UnifiedMeeting,
  gmail: ReturnType<typeof google.gmail>,
  anthropic: Anthropic,
): Promise<string> {
  const datePrefix     = meeting.startAt.toISOString().slice(0, 10)
  const startFormatted = meeting.startAt.toLocaleString('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  // ── S1: Zoom + host → webhook is primary; cron is 60-min fallback ─────────
  if (meeting.platform === 'Zoom' && meeting.isSiamakHost) {
    const minutesSinceEnd = (Date.now() - meeting.endAt.getTime()) / 60000
    if (minutesSinceEnd < 60) {
      return `⏭ Zoom host — waiting for webhook (${Math.round(minutesSinceEnd)} min since end)`
    }
    // Webhook didn't fire — generate calendar-data fallback with yellow warning
    const banner = `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:#856404;">
      <strong>⚠️ Zoom Recording Not Received</strong> — You were the host but the recording webhook did not arrive within 90 minutes.
      Check <a href="https://zoom.us/recording" style="color:#B8963E;font-weight:700;">zoom.us/recording</a> to confirm the recording exists.
      This summary was generated from calendar data only.
    </div>`
    return buildAndSendReport(meeting, gmail, anthropic, banner, 'calendar data (Zoom webhook fallback)', datePrefix, startFormatted)
  }

  // ── S2 / S3 / S4: Google Meet host OR any attendee → immediate calendar-data + blue banner ──
  const roleLabel  = meeting.isSiamakHost ? 'HOST' : 'ATTENDEE'
  const icon       = meeting.platform === 'Google Meet' ? '🟢' : '🔵'
  const banner = `<div style="background:#e3f2fd;border:1px solid #2196f3;border-radius:8px;padding:14px 18px;margin-bottom:16px;font-size:0.88rem;color:#0d47a1;line-height:1.6;">
    <strong>${icon} ${meeting.platform} — ${roleLabel}</strong><br/>
    Summary generated from calendar data. To add your notes and complete this report, visit
    <a href="${APP_URL}" style="color:#1565c0;font-weight:700;">${APP_URL}</a>
    — your notes will be saved to Drive automatically. No email will be sent.
  </div>`

  return buildAndSendReport(
    meeting, gmail, anthropic,
    banner,
    `calendar data (${meeting.isSiamakHost ? 'Google Meet host — notes can be added at VA' : 'attendee'})`,
    datePrefix, startFormatted,
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Google not connected' })

  const [googleMeetings, outlookMeetings] = await Promise.all([
    getGoogleMeetings(),
    getOutlookMeetings(),
  ])

  // Merge and deduplicate by title + start time
  const seen = new Set<string>()
  const allMeetings: UnifiedMeeting[] = []
  for (const m of [...googleMeetings, ...outlookMeetings]) {
    const key = `${m.title.toLowerCase().trim()}|${m.startAt.toISOString().slice(0, 16)}`
    if (!seen.has(key)) { seen.add(key); allMeetings.push(m) }
  }

  if (!allMeetings.length) {
    return NextResponse.json({ ok: true, message: 'No video meetings ended in the past 4 hours' })
  }

  const auth  = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const alreadyDone = await getAlreadyProcessedToday(gmail)
  const logs: string[] = []

  for (const meeting of allMeetings) {
    const titleKey = meeting.title.toLowerCase().trim()
    if (alreadyDone.has(titleKey)) {
      logs.push(`⏭ Already processed today: ${meeting.title}`)
      continue
    }
    try {
      const result = await processMeeting(meeting, gmail, anthropic)
      logs.push(result)
    } catch (err) {
      logs.push(`✗ Error processing "${meeting.title}": ${String(err)}`)
      console.error('[post-meeting] Error:', err)
    }
  }

  return NextResponse.json({
    ok: true, checked: allMeetings.length,
    google: googleMeetings.length, outlook: outlookMeetings.length,
    logs,
  })
}
