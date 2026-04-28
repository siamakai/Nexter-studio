import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

// ── Webhook verification ─────────────────────────────────────────────────────

function verifyZoomWebhook(req: NextRequest, body: string): boolean {
  const secret = process.env.ZOOM_WEBHOOK_SECRET
  if (!secret) return true // allow if secret not yet configured

  const timestamp = req.headers.get('x-zm-request-timestamp') || ''
  const signature = req.headers.get('x-zm-signature') || ''
  const message = `v0:${timestamp}:${body}`
  const hash = 'v0=' + crypto.createHmac('sha256', secret).update(message).digest('hex')
  return hash === signature
}

// ── Download Zoom transcript (VTT) ───────────────────────────────────────────

async function downloadTranscript(downloadUrl: string, downloadToken: string): Promise<string> {
  const res = await fetch(`${downloadUrl}?access_token=${downloadToken}`)
  if (!res.ok) throw new Error(`Transcript download failed: ${res.status}`)
  const vtt = await res.text()
  // Strip VTT header and timestamps, keep only spoken text
  return vtt
    .split('\n')
    .filter(line => line && !line.startsWith('WEBVTT') && !line.match(/^\d+$/) && !line.match(/^\d{2}:\d{2}/) && !line.startsWith('NOTE'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
}

// ── Find GHL contact by email ────────────────────────────────────────────────

async function findGhlContact(email: string): Promise<{ id: string; name: string } | null> {
  if (!process.env.GHL_API_KEY || !email) return null
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const c = data.contacts?.[0]
    if (!c) return null
    return { id: c.id, name: `${c.firstName || ''} ${c.lastName || ''}`.trim() }
  } catch { return null }
}

async function addGhlNote(contactId: string, note: string): Promise<void> {
  if (!process.env.GHL_API_KEY) return
  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: note }),
  })
}

// ── Save meeting file ────────────────────────────────────────────────────────

async function saveMeetingFile(filename: string, content: string): Promise<void> {
  const fs = await import('fs/promises')
  const path = await import('path')
  const dir = path.join(process.cwd(), 'meetings')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), content, 'utf-8')
}

// ── Send summary email ───────────────────────────────────────────────────────

async function sendSummaryEmail(subject: string, body: string): Promise<void> {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
  const raw = Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n')
  ).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

// ── Main webhook handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // Handle Zoom URL validation challenge
  let payload: Record<string, unknown>
  try { payload = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.event === 'endpoint.url_validation') {
    const plainToken = (payload.payload as Record<string, string>)?.plainToken || ''
    const secret = process.env.ZOOM_WEBHOOK_SECRET || ''
    const encryptedToken = crypto.createHmac('sha256', secret).update(plainToken).digest('hex')
    return NextResponse.json({ plainToken, encryptedToken })
  }

  if (!verifyZoomWebhook(req, rawBody)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const handled = ['recording.completed', 'recording.transcript_completed']
  if (!handled.includes(payload.event as string)) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Process in background — return 200 immediately so Zoom doesn't retry
  processRecording(payload).catch(err => console.error('[Zoom webhook error]', err))
  return NextResponse.json({ ok: true })
}

async function processRecording(payload: Record<string, unknown>) {
  const downloadToken = payload.download_token as string
  const obj = payload.payload as Record<string, unknown>
  const meeting = obj?.object as Record<string, unknown>

  const topic = (meeting?.topic as string) || 'Meeting'
  const hostEmail = (meeting?.host_email as string) || ''
  const startTime = new Date((meeting?.start_time as string) || Date.now()).toLocaleString('en-GB', {
    timeZone: 'Europe/Budapest', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const duration = (meeting?.duration as number) || 0
  const recordingFiles = (meeting?.recording_files as Record<string, unknown>[]) || []

  // Find transcript file
  const transcriptFile = recordingFiles.find(f =>
    (f.file_type as string) === 'TRANSCRIPT' || (f.recording_type as string) === 'audio_transcript'
  )

  let transcript = ''
  if (transcriptFile && downloadToken) {
    try {
      transcript = await downloadTranscript(transcriptFile.download_url as string, downloadToken)
    } catch (err) {
      console.error('[Zoom] Transcript download error:', err)
    }
  }

  // Generate summary with Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const summaryRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are the executive assistant to Dr. Siamak Goudarzi, Founder of Nexter AI Group.

A meeting just ended. Generate a structured report and summary.

MEETING: ${topic}
DATE: ${startTime}
DURATION: ${duration} minutes
HOST: ${hostEmail}

${transcript ? `TRANSCRIPT:\n${transcript}` : '(No transcript available — summarise from meeting title only)'}

Write a meeting report with these sections:
1. SUMMARY (2–3 sentences: what was discussed, what was decided)
2. KEY POINTS (bullet list of the most important things covered)
3. ACTION ITEMS (what needs to happen next, who is responsible)
4. CLIENT SENTIMENT (if apparent: positive / neutral / needs attention)
5. FOLLOW-UP RECOMMENDED (specific next step with suggested timeline)

Be precise and professional. Use plain text.`,
    }],
  })

  const summary = (summaryRes.content[0] as { type: 'text'; text: string }).text

  // Date prefix for filename
  const datePrefix = new Date().toISOString().slice(0, 10)
  const safeTopic = topic.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 50)
  const filename = `${datePrefix}-${safeTopic}.md`

  const fileContent = `# ${topic}
Date: ${startTime}
Duration: ${duration} min
Host: ${hostEmail}

${summary}

---
*Auto-generated by Nexter AI VA*
`

  // Save to meetings/ folder
  try { await saveMeetingFile(filename, fileContent) } catch (err) {
    console.error('[Zoom] File save error:', err)
  }

  // Find host in GHL and add note
  const hostContact = await findGhlContact(hostEmail)
  if (hostContact) {
    const crmNote = `MEETING SUMMARY — ${startTime}\nTopic: ${topic}\nDuration: ${duration} min\n\n${summary}`
    await addGhlNote(hostContact.id, crmNote)
  }

  // Send summary email
  const emailSubject = `Meeting Summary: ${topic} — ${datePrefix}`
  const emailBody = `MEETING SUMMARY\n${'─'.repeat(50)}\nTopic: ${topic}\nDate: ${startTime}\nDuration: ${duration} minutes\n\n${summary}\n\n${'─'.repeat(50)}\nSaved to: meetings/${filename}${hostContact ? `\nLogged in CRM for: ${hostContact.name}` : ''}`

  try { await sendSummaryEmail(emailSubject, emailBody) } catch (err) {
    console.error('[Zoom] Email error:', err)
  }

  console.log(`[Zoom] Processed recording: ${topic} → ${filename}`)
}
