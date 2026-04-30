/**
 * Shared utilities for meeting report processing.
 * Used by: Zoom webhook, Google Meet cron, manual notes endpoint.
 */

import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import Anthropic from '@anthropic-ai/sdk'
import path from 'path'
import fs from 'fs/promises'

const MEETINGS_FOLDER_NAME = 'Nexter AI — Meeting Reports'
const TO = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'

// ─── CLAUDE SUMMARY ──────────────────────────────────────────────────────────

export async function generateMeetingSummary(
  title: string,
  date: string,
  transcript: string,
  durationMin?: number
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    messages: [{
      role: 'user',
      content: `You are the executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.

A meeting just ended. Generate a precise, professional meeting report.

MEETING: ${title}
DATE: ${date}
${durationMin ? `DURATION: ${durationMin} minutes` : ''}

${transcript ? `TRANSCRIPT / NOTES:\n${transcript}` : '(No transcript — use meeting title for context only)'}

Write the report in exactly these sections:

## SUMMARY
2–3 sentences: what was discussed, what was decided.

## KEY POINTS
- Bullet list of the most important topics covered.

## ACTION ITEMS
- Each item must have: what to do, who is responsible, and deadline if mentioned.
- If none: write "None identified."

## CLIENT SENTIMENT
One of: Positive / Neutral / Needs Attention — with one sentence of reasoning.

## FOLLOW-UP RECOMMENDED
Specific next step with a suggested timeline. Be concrete (e.g. "Send proposal by Friday", not "Follow up soon").

Plain text only. No markdown headers beyond ##.`,
    }],
  })
  return (res.content[0] as { type: 'text'; text: string }).text
}

// ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────────

let _meetingsFolderId: string | null = null

async function getMeetingsFolderId(drive: ReturnType<typeof google.drive>): Promise<string> {
  if (_meetingsFolderId) return _meetingsFolderId

  // Search for existing folder
  const { data } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${MEETINGS_FOLDER_NAME}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  })

  if (data.files?.length) {
    _meetingsFolderId = data.files[0].id!
    return _meetingsFolderId
  }

  // Create it
  const folder = await drive.files.create({
    requestBody: {
      name: MEETINGS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  })
  _meetingsFolderId = folder.data.id!
  console.log(`[meeting-report] Created Drive folder: ${MEETINGS_FOLDER_NAME} (${_meetingsFolderId})`)
  return _meetingsFolderId
}

export async function saveMeetingToDrive(
  title: string,
  content: string,
  date: string
): Promise<string | null> {
  try {
    const auth = await getAuthedClient()
    const drive = google.drive({ version: 'v3', auth })
    const folderId = await getMeetingsFolderId(drive)

    const docName = `${date} — ${title}`.slice(0, 120)
    const file = await drive.files.create({
      requestBody: {
        name: docName,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: content,
      },
      fields: 'id, webViewLink',
    })

    return file.data.webViewLink || null
  } catch (err) {
    console.error('[meeting-report] Drive save error:', err)
    return null
  }
}

// ─── LOCAL FILE BACKUP ────────────────────────────────────────────────────────

export async function saveMeetingLocally(filename: string, content: string): Promise<void> {
  try {
    const dir = path.join(process.cwd(), 'meetings')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, filename), content, 'utf-8')
  } catch (err) {
    console.error('[meeting-report] Local save error:', err)
  }
}

// ─── GHL CRM ─────────────────────────────────────────────────────────────────

export async function findGhlContact(query: string): Promise<{ id: string; name: string } | null> {
  if (!process.env.GHL_API_KEY || !query) return null
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(query)}&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const c = data.contacts?.[0]
    if (!c) return null
    return { id: c.id, name: `${c.firstName || ''} ${c.lastName || ''}`.trim() }
  } catch { return null }
}

export async function addGhlNote(contactId: string, note: string): Promise<void> {
  if (!process.env.GHL_API_KEY) return
  try {
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: note }),
    })
  } catch (err) {
    console.error('[meeting-report] GHL note error:', err)
  }
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────

export async function sendMeetingEmail(
  subject: string,
  htmlBody: string,
): Promise<void> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const raw = Buffer.from([
    `To: ${TO}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\r\n')).toString('base64url')

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

export async function sendNoTranscriptAlert(
  meetingTitle: string,
  meetingDate: string,
  notesEndpointUrl: string,
): Promise<void> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const html = `
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;color:#1a2035;">
  <div style="background:#0F2347;padding:18px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1rem;">⚠️ Meeting Transcript Not Found</h2>
    <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:0.78rem;font-family:monospace;">Nexter AI VA — Action Required</p>
  </div>
  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;">
    <p style="color:#333;font-size:0.9rem;">A Google Meet ended but <strong>no transcript was found</strong> in Google Drive.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:0.85rem;">
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;width:35%;">Meeting</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${meetingTitle}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Date</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${meetingDate}</td></tr>
    </table>
    <p style="color:#555;font-size:0.88rem;line-height:1.6;">To create a meeting summary, please do one of the following:</p>
    <ol style="color:#333;font-size:0.88rem;line-height:1.8;padding-left:20px;">
      <li><strong>Enable transcription</strong> in Google Meet before future calls: click <em>Activities → Transcription → Start</em></li>
      <li><strong>Share your notes</strong> by sending them to the VA via the chat, and ask it to save the meeting report</li>
    </ol>
    <div style="background:#fffbf0;border:1px solid #e8d9a0;border-radius:6px;padding:12px;margin-top:14px;">
      <strong style="color:#7a5c1e;font-size:0.85rem;">📋 How to enable transcription going forward:</strong>
      <p style="color:#5a4a2a;font-size:0.82rem;margin:6px 0 0;line-height:1.6;">In Google Meet → click the three dots menu → <em>Transcribe meeting</em>. Google will auto-save the transcript to Drive when the call ends.</p>
    </div>
    <p style="margin-top:14px;font-size:0.72rem;color:#aaa;border-top:1px solid #ede5d6;padding-top:10px;font-family:monospace;">Nexter AI VA · Meeting Intelligence · ${new Date().toLocaleDateString('en-GB')}</p>
  </div>
</div>`

  const raw = Buffer.from([
    `To: ${TO}`,
    `Subject: ⚠️ No Transcript Found — ${meetingTitle} (${meetingDate})`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n')).toString('base64url')

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

// ─── FULL MEETING REPORT EMAIL ─────────────────────────────────────────────

export function buildMeetingEmailHtml(opts: {
  title: string
  date: string
  source: 'Zoom' | 'Google Meet' | 'Manual Notes'
  summary: string
  driveUrl: string | null
  contactName: string | null
  durationMin?: number
}): string {
  const { title, date, source, summary, driveUrl, contactName, durationMin } = opts
  const summaryHtml = summary
    .split('\n')
    .map(line => {
      if (line.startsWith('## ')) return `<h3 style="color:#0F2347;font-size:0.9rem;margin:14px 0 4px;">${line.replace('## ', '')}</h3>`
      if (line.startsWith('- ')) return `<li style="color:#333;font-size:0.85rem;line-height:1.6;">${line.slice(2)}</li>`
      if (line.trim() === '') return '<br/>'
      return `<p style="color:#333;font-size:0.85rem;line-height:1.6;margin:2px 0;">${line}</p>`
    })
    .join('\n')

  return `
<div style="font-family:Georgia,serif;max-width:660px;margin:0 auto;color:#1a2035;">
  <div style="background:#0F2347;padding:18px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1.05rem;">📋 Meeting Report — ${title}</h2>
    <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:0.78rem;font-family:monospace;">${source} · ${date}${durationMin ? ` · ${durationMin} min` : ''}</p>
  </div>
  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:0.85rem;">
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;width:30%;">Meeting</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${title}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Date</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${date}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Source</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${source}</td></tr>
      ${contactName ? `<tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">CRM Contact</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${contactName} ✓ logged</td></tr>` : ''}
      ${driveUrl ? `<tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Google Drive</td><td style="padding:6px 9px;border:1px solid #ede5d6;"><a href="${driveUrl}" style="color:#1a73e8;">Open in Drive →</a></td></tr>` : ''}
    </table>
    <div style="border-left:3px solid #B8963E;padding-left:14px;">
      ${summaryHtml}
    </div>
    <p style="margin-top:16px;font-size:0.72rem;color:#aaa;border-top:1px solid #ede5d6;padding-top:10px;font-family:monospace;">
      Nexter AI VA · Meeting Intelligence · Auto-generated · For internal use only
    </p>
  </div>
</div>`
}
