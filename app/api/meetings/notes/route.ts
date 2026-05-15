/**
 * POST /api/meetings/notes
 *
 * Manual meeting notes submission — used when no transcript was recorded.
 * Called from va.nexterai.agency after Siamak submits his own notes.
 *
 * Generates a full AI summary from the notes, saves to the
 * "Nexter AI — Meeting Reports" Google Drive folder, and logs to GHL CRM.
 * No notification email is sent — the blue banner in the original report
 * already explained this is where notes go.
 *
 * Body: { title, date?, attendees?, notes, contact_email? }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  generateMeetingSummary,
  saveMeetingToDrive,
  findGhlContact,
  addGhlNote,
  autoTagContact,
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
    timeZone: 'Europe/Budapest', weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const datePrefix = new Date().toISOString().slice(0, 10)

  // Respond immediately — Drive + Claude can take a few seconds
  processNotes({ title, meetingDate, datePrefix, attendees, notes, contact_email })
    .catch(err => console.error('[meetings/notes]', err))

  return NextResponse.json(
    { ok: true, message: 'Notes received — summary will be saved to Drive shortly' },
    { headers: cors() }
  )
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

  const fileContent = [
    `# ${title}`,
    `Date: ${meetingDate}`,
    `Source: Manual Notes${attendees ? `\nAttendees: ${attendees}` : ''}`,
    '',
    summary,
    '',
    '---',
    '*Notes submitted via Nexter AI VA · Nexter AI VA*',
  ].join('\n')

  await saveMeetingToDrive(title, fileContent, datePrefix)

  // CRM update
  let contact = contact_email ? await findGhlContact(contact_email) : null
  if (!contact && attendees) contact = await findGhlContact(attendees.split(/[,;\n]/)[0].trim())
  if (!contact) contact = await findGhlContact(title.split(/\s+/).slice(0, 3).join(' '))

  if (contact) {
    await addGhlNote(contact.id, `MEETING NOTES SUMMARY — ${meetingDate}\nMeeting: ${title}\n\n${summary}`)
    await autoTagContact(contact.id, summary, title)
  }
}
