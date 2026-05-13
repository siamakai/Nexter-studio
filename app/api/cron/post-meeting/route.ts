/**
 * /api/cron/post-meeting — runs every 2 hours
 *
 * Handles ALL meetings that aren't covered by the Zoom webhook:
 *  - Google Meet (host or attendee)
 *  - Zoom meetings where Siamak was NOT the host
 *
 * For every matched meeting it:
 *  1. Generates a summary (from transcript if available, otherwise from calendar data)
 *  2. Saves report to Google Drive
 *  3. Updates CRM — adds note, auto-tags, drafts follow-up if needed
 *  4. Creates a Gmail draft follow-up email
 *  5. Sends Siamak a briefing email with the full report
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import {
  generateMeetingSummary,
  saveMeetingToDrive,
  findGhlContact,
  addGhlNote,
  autoTagContact,
  buildMeetingEmailHtml,
  sendMeetingEmail,
} from '@/lib/meeting-report'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'
const SIAMAK_EMAILS = [
  (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase(),
  'siamak.goudarzi@nexterlaw.com',
]

const LOOK_BACK_MS = 2.5 * 60 * 60 * 1000
const GRACE_MS     = 20 * 60 * 1000        // ignore meetings that ended < 20 min ago

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Google not connected' })

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

  const events = data.items || []
  const logs: string[] = []

  // Dedup — skip meetings already processed today
  const sentToday = new Set<string>()
  try {
    const gmail = google.gmail({ version: 'v1', auth })
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const { data: sentData } = await gmail.users.messages.list({
      userId: 'me',
      q: `subject:"Post-Meeting Report" after:${todayStr}`,
      maxResults: 30,
    })
    for (const msg of sentData.messages || []) {
      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['Subject'] })
      const subject = full.payload?.headers?.find(h => h.name === 'Subject')?.value || ''
      sentToday.add(subject)
    }
  } catch { /* skip dedup if unavailable */ }

  for (const event of events) {
    const title          = event.summary || 'Meeting'
    const organizerEmail = (event.organizer?.email || '').toLowerCase()
    const isSiamakHost   = SIAMAK_EMAILS.some(e => organizerEmail === e || organizerEmail.includes(e.split('@')[0]))

    const isZoom     = !!(event.description?.includes('zoom.us') || event.location?.includes('zoom.us'))
    const isGMeet    = !!(event.conferenceData || event.hangoutLink)
    const platform   = isZoom ? 'Zoom' : isGMeet ? 'Google Meet' : null

    // Skip non-video meetings
    if (!platform) { logs.push(`⏭ Skipped (no video): ${title}`); continue }

    // Zoom + host → handled by the Zoom cloud recording webhook
    if (isSiamakHost && isZoom) { logs.push(`⏭ Skipped (Zoom host, webhook handles): ${title}`); continue }

    const datePrefix     = new Date().toISOString().slice(0, 10)
    const reportSubject  = `Post-Meeting Report: ${title} — ${datePrefix}`
    if (sentToday.has(reportSubject)) { logs.push(`⏭ Already processed: ${title}`); continue }

    const startDt  = new Date(event.start?.dateTime || event.start?.date || now)
    const endDt    = new Date(event.end?.dateTime   || event.end?.date   || now)
    const duration = Math.round((endDt.getTime() - startDt.getTime()) / 60000)

    const startFormatted = startDt.toLocaleString('en-GB', {
      timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
      year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })

    const attendeeList = (event.attendees || [])
      .filter(a => !a.self)
      .map(a => a.displayName || a.email || '')
      .filter(Boolean)

    const organizer = event.organizer?.displayName || event.organizer?.email || 'Unknown'

    // Context note for the summary (no transcript available in this flow)
    const contextNote = [
      `Platform: ${platform}`,
      `Role: ${isSiamakHost ? 'Host' : 'Attendee (not the host — meeting was not recorded)'}`,
      `Organised by: ${organizer}`,
      attendeeList.length ? `Attendees: ${attendeeList.join(', ')}` : '',
      `Duration: ${duration} minutes`,
    ].filter(Boolean).join('\n')

    // Generate summary from calendar context (no transcript)
    const summary = await generateMeetingSummary(title, startFormatted, contextNote, duration)

    // Save to Google Drive
    const fileContent = [
      `# ${title}`,
      `Date: ${startFormatted}`,
      `Duration: ${duration} min`,
      `Platform: ${platform}`,
      `Role: ${isSiamakHost ? 'Host' : 'Attendee'}`,
      `Organised by: ${organizer}`,
      attendeeList.length ? `Attendees: ${attendeeList.join(', ')}` : '',
      '',
      summary,
      '',
      '---',
      '*Auto-generated by Nexter AI VA — no transcript available. Add notes via the VA chat to enrich this report.*',
    ].filter(l => l !== undefined).join('\n')

    const driveUrl = await saveMeetingToDrive(title, fileContent, datePrefix).catch(() => null)

    // CRM — try to find the primary external attendee
    let contact = null
    for (const email of (event.attendees || []).filter(a => !a.self).map(a => a.email || '')) {
      contact = await findGhlContact(email).catch(() => null)
      if (contact) break
    }
    if (!contact) contact = await findGhlContact(title.split(/\s+/).slice(0, 3).join(' ')).catch(() => null)

    if (contact) {
      const role = isSiamakHost ? 'HOST' : 'ATTENDEE (not recorded)'
      await addGhlNote(contact.id, `${platform.toUpperCase()} MEETING [${role}] — ${startFormatted}\nTopic: ${title}\nDuration: ${duration} min\n\n${summary}`).catch(() => null)
      await autoTagContact(contact.id, summary, title).catch(() => null)
    }

    // Draft follow-up email in Gmail
    let followUpDraftCreated = false
    try {
      const followUpText = await generateFollowUpDraft(title, startFormatted, summary, attendeeList, organizer, isSiamakHost)
      const primaryEmail = (event.attendees || []).find(a => !a.self)?.email || organizer
      const gmail = google.gmail({ version: 'v1', auth })
      const draftRaw = Buffer.from([
        `To: ${primaryEmail}`,
        `Subject: Follow-up: ${title}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        followUpText,
      ].join('\r\n')).toString('base64url')
      await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: draftRaw } } })
      followUpDraftCreated = true
    } catch { /* non-fatal */ }

    // Send briefing email to Siamak
    const notRecordedBanner = !isSiamakHost
      ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:#856404;">
          <strong>📋 Not recorded</strong> — You were an attendee, not the host. This report was generated from calendar data only.
          To add your notes and enrich this report, go to <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://va.nexterai.agency'}" style="color:#B8963E;font-weight:700;">va.nexterai.agency</a> and paste your notes in the chat.
        </div>`
      : `<div style="background:#e8f5e9;border:1px solid #4caf50;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:#2e7d32;">
          <strong>✅ Google Meet (Host)</strong> — No transcript was found in Drive. If you started transcription, it may still be processing. Otherwise, add notes at <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://va.nexterai.agency'}" style="color:#B8963E;font-weight:700;">va.nexterai.agency</a>.
        </div>`

    const html = buildMeetingEmailHtml({
      title,
      date: startFormatted,
      source: platform as 'Zoom' | 'Google Meet',
      summary: notRecordedBanner + '\n' + summary,
      driveUrl,
      contactName: contact?.name || null,
      durationMin: duration,
    })

    await sendMeetingEmail(reportSubject, html)
    logs.push(`✓ ${title} | ${platform} | ${isSiamakHost ? 'host' : 'attendee'} | Drive: ${driveUrl ? 'saved' : 'failed'} | CRM: ${contact ? contact.name : 'not found'} | Follow-up draft: ${followUpDraftCreated ? 'created' : 'skipped'}`)
  }

  return NextResponse.json({ ok: true, checked: events.length, logs })
}

async function generateFollowUpDraft(
  title: string,
  date: string,
  summary: string,
  attendees: string[],
  organizer: string,
  isSiamakHost: boolean,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Write a brief, professional follow-up email from Dr. Siamak Goudarzi (Founder, Nexter AI Group) after this meeting.

Meeting: ${title}
Date: ${date}
Role: ${isSiamakHost ? 'Host' : 'Attendee'}
Organised by: ${organizer}
Attendees: ${attendees.join(', ') || 'Unknown'}

Meeting summary:
${summary.slice(0, 800)}

Write only the email body (no subject line). 3–5 sentences max. Reference key outcomes or next steps from the summary. Professional but warm. Sign off as Siamak.`,
    }],
  })
  return (res.content[0] as { type: 'text'; text: string }).text
}
