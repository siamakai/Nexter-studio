/**
 * POST /api/meetings/notes
 *
 * Manual meeting notes submission — used when no transcript was recorded.
 * Accepts notes from the VA chat or direct API call, generates a summary,
 * saves to Google Drive, logs to GHL CRM, and emails info@i-review.ai.
 *
 * Body: { title, date?, attendees?, notes, contact_email? }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  generateMeetingSummary,
  saveMeetingToDrive,
  saveMeetingLocally,
  findGhlContact,
  addGhlNote,
  sendMeetingEmail,
  buildMeetingEmailHtml,
} from '@/lib/meeting-report'

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() })
}

export async function POST(req: NextRequest) {
  let body: Record<string, string> = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: cors() })
  }

  const { title, date, attendees, notes, contact_email } = body

  if (!title || !notes) {
    return NextResponse.json(
      { ok: false, error: 'Required fields: title, notes' },
      { status: 400, headers: cors() }
    )
  }

  const meetingDate = date || new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/Budapest', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const datePrefix = new Date().toISOString().slice(0, 10)

  // Respond immediately, process in background
  processNotes({ title, meetingDate, datePrefix, attendees, notes, contact_email })
    .catch(err => console.error('[meetings/notes]', err))

  return NextResponse.json({ ok: true, message: 'Notes received — summary will be emailed shortly' }, { headers: cors() })
}

async function processNotes(opts: {
  title: string
  meetingDate: string
  datePrefix: string
  attendees?: string
  notes: string
  contact_email?: string
}) {
  const { title, meetingDate, datePrefix, attendees, notes, contact_email } = opts

  const contextBlock = [
    attendees ? `ATTENDEES: ${attendees}` : '',
    `NOTES:\n${notes}`,
  ].filter(Boolean).join('\n\n')

  const summary = await generateMeetingSummary(title, meetingDate, contextBlock)

  const safeName = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 50)
  const localFilename = `${datePrefix}-manual-${safeName}.md`
  const fileContent = `# ${title}\nDate: ${meetingDate}\nSource: Manual Notes${attendees ? `\nAttendees: ${attendees}` : ''}\n\n${summary}\n\n---\n*Submitted manually via Nexter AI VA*\n`

  await saveMeetingLocally(localFilename, fileContent)
  const driveUrl = await saveMeetingToDrive(title, fileContent, datePrefix)

  // Find CRM contact by provided email, attendee list, or meeting title
  let contact = contact_email ? await findGhlContact(contact_email) : null
  if (!contact && attendees) contact = await findGhlContact(attendees.split(/[,;\n]/)[0].trim())
  if (!contact) contact = await findGhlContact(title.split(/\s+/).slice(0, 3).join(' '))

  if (contact) {
    await addGhlNote(contact.id, `MEETING NOTES SUMMARY — ${meetingDate}\nMeeting: ${title}\n\n${summary}`)
  }

  const html = buildMeetingEmailHtml({
    title,
    date: meetingDate,
    source: 'Manual Notes',
    summary,
    driveUrl,
    contactName: contact?.name || null,
  })

  await sendMeetingEmail(`📋 Meeting Notes: ${title} — ${datePrefix}`, html)
}
