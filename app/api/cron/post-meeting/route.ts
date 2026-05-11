/**
 * POST /api/cron/post-meeting
 *
 * Runs every 2 hours. Scans Google Calendar for meetings that ended
 * in the last window where Siamak was NOT the organizer (non-host).
 * Sends an email reminder to submit meeting notes via the VA.
 */

import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { sendMeetingEmail } from '@/lib/meeting-report'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'
const VA_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://va.nexterai.agency'

// Siamak's known emails — meetings where he's organizer are handled by Zoom webhook
const SIAMAK_EMAILS = [
  (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase(),
  'siamak.goudarzi@nexterlaw.com',
]

// Look back 2.5 hours, skip meetings that ended less than 20 min ago (still processing)
const LOOK_BACK_MS  = 2.5 * 60 * 60 * 1000
const GRACE_MS      = 20 * 60 * 1000

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Google not connected' })

  const auth  = await getAuthedClient()
  const cal   = google.calendar({ version: 'v3', auth })
  const now   = Date.now()

  const { data } = await cal.events.list({
    calendarId: 'primary',
    timeMin: new Date(now - LOOK_BACK_MS).toISOString(),
    timeMax: new Date(now - GRACE_MS).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  })

  const events = data.items || []
  const logs: string[] = []

  for (const event of events) {
    const title         = event.summary || 'Meeting'
    const organizerEmail = (event.organizer?.email || '').toLowerCase()
    const isSiamakHost   = SIAMAK_EMAILS.some(e => organizerEmail === e || organizerEmail.includes(e.split('@')[0]))

    // Only process meetings where Siamak is NOT the organizer
    if (isSiamakHost) { logs.push(`⏭ Skipped (host): ${title}`); continue }

    // Only process video meetings (Zoom or Google Meet)
    const hasVideo =
      event.conferenceData ||
      event.hangoutLink ||
      event.description?.includes('zoom.us') ||
      event.location?.includes('zoom.us')

    if (!hasVideo) { logs.push(`⏭ Skipped (no video): ${title}`); continue }

    const startDt = new Date(event.start?.dateTime || event.start?.date || now)
    const endDt   = new Date(event.end?.dateTime   || event.end?.date   || now)
    const duration = Math.round((endDt.getTime() - startDt.getTime()) / 60000)

    const startFormatted = startDt.toLocaleString('en-GB', {
      timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
      year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })

    const attendees = (event.attendees || [])
      .map(a => a.displayName || a.email || null)
      .filter((x): x is string => !!x)
      .join(', ')

    const organizer = event.organizer?.displayName || event.organizer?.email || 'Unknown host'

    await sendNonHostReminder({ title, startFormatted, duration, attendees, organizer })
    logs.push(`📧 Reminder sent: ${title} (hosted by ${organizer})`)
  }

  return NextResponse.json({ ok: true, checked: events.length, logs })
}

async function sendNonHostReminder(opts: {
  title: string
  startFormatted: string
  duration: number
  attendees: string
  organizer: string
}) {
  const { title, startFormatted, duration, attendees, organizer } = opts
  const promptSuggestion = `Save meeting notes for "${title}" on ${startFormatted} with ${attendees || organizer}`

  const html = `
<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#1a2035;">
  <div style="background:#0F2347;padding:18px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1rem;">📋 Meeting Notes Needed</h2>
    <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:0.78rem;font-family:monospace;">Nexter AI VA — Action Required</p>
  </div>
  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:22px 24px;border-radius:0 0 8px 8px;">

    <p style="color:#333;font-size:0.9rem;margin:0 0 14px;">You attended a meeting where you were <strong>not the host</strong>, so it could not be recorded automatically. Please submit your notes so this meeting can be documented.</p>

    <table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:18px;">
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;width:30%;">Meeting</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${title}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Date</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${startFormatted}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Duration</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${duration} minutes</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Hosted by</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${organizer}</td></tr>
      ${attendees ? `<tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Attendees</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${attendees}</td></tr>` : ''}
    </table>

    <div style="background:#fffbf0;border:1px solid #e8d9a0;border-radius:8px;padding:14px 16px;margin-bottom:18px;">
      <p style="margin:0 0 8px;font-size:0.85rem;font-weight:700;color:#7a5c1e;">How to submit your notes:</p>
      <ol style="margin:0;padding-left:18px;font-size:0.84rem;color:#5a4a2a;line-height:1.8;">
        <li>Go to <a href="${VA_URL}" style="color:#B8963E;font-weight:700;">${VA_URL}</a></li>
        <li>Type or paste the following in the chat:</li>
      </ol>
      <div style="background:#f0ebe0;border:1px solid #d4c89a;border-radius:6px;padding:10px 12px;margin-top:8px;font-family:monospace;font-size:0.82rem;color:#3a2e10;">
        "${promptSuggestion}"
      </div>
      <p style="margin:8px 0 0;font-size:0.8rem;color:#7a6a40;">Then paste or dictate your notes. VA will generate a full summary, save it to Google Drive, and update the CRM automatically.</p>
    </div>

    <p style="font-size:0.72rem;color:#aaa;border-top:1px solid #ede5d6;padding-top:10px;margin:0;font-family:monospace;">
      Nexter AI VA · Post-Meeting Intelligence · Auto-generated · ${new Date().toLocaleDateString('en-GB')}
    </p>
  </div>
</div>`

  await sendMeetingEmail(`📋 Notes Needed: ${title} — ${new Date().toISOString().slice(0, 10)}`, html)
}
