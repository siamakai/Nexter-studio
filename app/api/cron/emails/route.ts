import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'
import { processLead } from '@/lib/lead-processor'

// ── Gmail Label Manager ───────────────────────────────────────────────────────

const LABEL_DEFINITIONS = [
  { name: 'VA/🚨 Urgent',        color: { backgroundColor: '#fb4c2f', textColor: '#ffffff' } },
  { name: 'VA/📋 Action Needed', color: { backgroundColor: '#ffad47', textColor: '#ffffff' } },
  { name: 'VA/ℹ️ FYI',           color: { backgroundColor: '#4986e7', textColor: '#ffffff' } },
  { name: 'VA/✅ No Action',      color: { backgroundColor: '#b9e4d0', textColor: '#000000' } },
]

// Cache label IDs for this invocation
const labelCache: Record<string, string> = {}

async function getOrCreateLabel(gmail: ReturnType<typeof google.gmail>, labelName: string): Promise<string | null> {
  if (labelCache[labelName]) return labelCache[labelName]

  try {
    const { data } = await gmail.users.labels.list({ userId: 'me' })
    const existing = (data.labels || []).find(l => l.name === labelName)
    if (existing?.id) {
      labelCache[labelName] = existing.id
      return existing.id
    }

    // Create label
    const def = LABEL_DEFINITIONS.find(d => d.name === labelName)
    const { data: created } = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        ...(def ? { color: def.color } : {}),
      },
    })
    if (created.id) {
      labelCache[labelName] = created.id
      return created.id
    }
  } catch { /* non-critical */ }
  return null
}

async function applyLabel(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  category: string,
): Promise<void> {
  const labelMap: Record<string, string> = {
    'urgent':       'VA/🚨 Urgent',
    'action-needed':'VA/📋 Action Needed',
    'fyi':          'VA/ℹ️ FYI',
    'no-action':    'VA/✅ No Action',
  }
  const labelName = labelMap[category]
  if (!labelName) return

  const labelId = await getOrCreateLabel(gmail, labelName)
  if (!labelId) return

  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: [labelId] },
    })
  } catch { /* non-critical */ }
}

// ── Inbox Triage ─────────────────────────────────────────────────────────────

async function triageEmail(opts: {
  from: string; subject: string; body: string; gmail: ReturnType<typeof google.gmail>; threadId: string; messageId: string
}): Promise<void> {
  const { from, subject, body, gmail, threadId, messageId } = opts
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Triage this email for Dr. Siamak Goudarzi, Founder of Nexter AI Group. Return ONLY valid JSON, no markdown.

FROM: ${from}
SUBJECT: ${subject}
BODY: ${body.slice(0, 800)}

Return: {"category":"urgent|action-needed|fyi|no-action","reason":"one sentence why","draft_reply":"full professional reply if action-needed or urgent, else null"}

Rules for category:
- urgent: needs response TODAY (client issue, time-sensitive deal, legal/financial, meeting today)
- action-needed: needs a reply but not urgent (general inquiry, follow-up request)
- fyi: informational, no reply needed
- no-action: newsletter, notification, spam

Rules for draft_reply:
- Write a complete, professional email body ready to send — NOT a short acknowledgment
- Address the specific points raised in the email
- Sign off as: "Best regards,\nSiamak Goudarzi\nFounder, Nexter AI Group"
- 3–6 sentences, warm and direct`,
    }],
  })

  const raw = (res.content[0] as { text: string }).text.trim()
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return
  const triage: { category: string; reason: string; draft_reply: string | null } = JSON.parse(match[0])

  // Apply Gmail label to every email regardless of category
  await applyLabel(gmail, messageId, triage.category)

  if (triage.category === 'no-action' || triage.category === 'fyi') return

  // Save draft reply to Gmail Drafts
  if (triage.draft_reply) {
    try {
      const myEmail = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
      const rawEmail = [
        `From: ${myEmail}`,
        `To: ${from}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${messageId}`,
        `References: ${messageId}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        triage.draft_reply,
      ].join('\r\n')
      await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: Buffer.from(rawEmail).toString('base64url'), threadId } },
      })
    } catch { /* non-critical */ }
  }

  // For urgent: send an immediate alert
  if (triage.category === 'urgent') {
    try {
      const myEmail = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const raw = Buffer.from([
        `To: ${myEmail}`,
        `Subject: =?utf-8?B?${Buffer.from(`🚨 URGENT EMAIL: ${subject}`).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `URGENT email requires your attention today.\n\nFrom: ${from}\nSubject: ${subject}\nReason: ${triage.reason}\n\n${triage.draft_reply ? '✅ A draft reply has been prepared and saved to your Gmail Drafts folder. Review and send it at: https://mail.google.com/#drafts' : 'No draft was generated for this email.'}`,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch { /* non-critical */ }
  }
}

// Vercel protects cron routes with CRON_SECRET header automatically
function isAuthorized(req: NextRequest) {
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

// ── Gmail ────────────────────────────────────────────────────────────────────

async function processGmailAccount(accountEmail: string): Promise<string[]> {
  const logs: string[] = []
  try {
    const auth = await getAuthedClient(accountEmail)
    const gmail = google.gmail({ version: 'v1', auth })

    // Pre-load VA label IDs so we can skip already-triaged emails
    await Promise.all(LABEL_DEFINITIONS.map(d => getOrCreateLabel(gmail, d.name)))
    const vaLabelIds = new Set(Object.values(labelCache))

    // Emails received in the last 20 minutes (cron runs every 15 min, slight overlap is fine)
    const after = Math.floor((Date.now() - 20 * 60 * 1000) / 1000)
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${after} -from:me -label:sent -category:promotions -category:updates`,
      maxResults: 20,
    })

    const messages = listRes.data.messages || []
    for (const msg of messages) {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' })
      const headers = full.data.payload?.headers || []
      const get = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

      const from = get('From')
      const subject = get('Subject')
      const emailMatch = from.match(/<(.+?)>/) || [null, from]
      const fromEmail = emailMatch[1]?.trim() || from.trim()
      const fromName = from.replace(/<.+>/, '').trim().replace(/"/g, '')

      // Skip if it's from ourselves
      if (fromEmail.toLowerCase() === accountEmail.toLowerCase()) continue

      // Skip if already triaged — has a VA label from a previous cron run
      const existingLabels = full.data.labelIds || []
      if (existingLabels.some(id => vaLabelIds.has(id))) continue

      // Extract body text
      let body = ''
      const parts = full.data.payload?.parts || [full.data.payload]
      for (const part of parts) {
        if (part?.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8').slice(0, 2000)
          break
        }
      }
      if (!body) {
        // Try HTML part as fallback, strip tags
        for (const part of parts) {
          if (part?.mimeType === 'text/html' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64')
              .toString('utf-8')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .slice(0, 2000)
            break
          }
        }
      }

      const result = await processLead({
        type: 'email',
        from_email: fromEmail,
        from_name: fromName,
        subject,
        body: body || '(no body)',
        source_account: accountEmail,
      })
      logs.push(`[Gmail:${accountEmail}] ${result.message}`)

      // Inbox triage — runs in parallel, non-blocking
      triageEmail({
        from: `${fromName} <${fromEmail}>`,
        subject,
        body: body || '',
        gmail,
        threadId: full.data.threadId || msg.id!,
        messageId: msg.id!,
      }).catch(e => console.error('[triage]', e))
    }
  } catch (err) {
    logs.push(`[Gmail:${accountEmail}] ERROR: ${String(err)}`)
  }
  return logs
}

// ── Microsoft 365 ────────────────────────────────────────────────────────────

async function processMicrosoftAccount(accountEmail: string): Promise<string[]> {
  const logs: string[] = []
  try {
    const token = await getMsAccessToken(accountEmail)
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString()

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=receivedDateTime ge ${since}&$top=20&$select=from,subject,body,receivedDateTime`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )
    if (!res.ok) throw new Error(`MS Graph ${res.status}`)

    const data = await res.json()
    const messages = data.value || []

    for (const msg of messages) {
      const fromEmail = msg.from?.emailAddress?.address || ''
      const fromName = msg.from?.emailAddress?.name || ''

      if (fromEmail.toLowerCase() === accountEmail.toLowerCase()) continue

      const body = (msg.body?.content || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 2000)

      const result = await processLead({
        type: 'email',
        from_email: fromEmail,
        from_name: fromName,
        subject: msg.subject || '',
        body: body || '(no body)',
        source_account: accountEmail,
      })
      logs.push(`[Outlook:${accountEmail}] ${result.message}`)
    }
  } catch (err) {
    logs.push(`[Outlook:${accountEmail}] ERROR: ${String(err)}`)
  }
  return logs
}

// ── Calendly polling ─────────────────────────────────────────────────────────

async function processCalendlyBookings(): Promise<string[]> {
  const logs: string[] = []
  if (!process.env.CALENDLY_API_KEY) return logs

  try {
    // Get current user URI
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${process.env.CALENDLY_API_KEY}` },
    })
    if (!meRes.ok) throw new Error(`Calendly /users/me ${meRes.status}`)
    const me = await meRes.json()
    const userUri = me.resource?.uri

    // Events created in the last 20 minutes
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const params = new URLSearchParams({
      user: userUri,
      min_start_time: since,
      status: 'active',
      count: '20',
    })

    const eventsRes = await fetch(`https://api.calendly.com/scheduled_events?${params}`, {
      headers: { Authorization: `Bearer ${process.env.CALENDLY_API_KEY}` },
    })
    if (!eventsRes.ok) throw new Error(`Calendly events ${eventsRes.status}`)
    const eventsData = await eventsRes.json()
    const events = eventsData.collection || []

    for (const event of events) {
      // Get invitees for this event
      const eventUuid = event.uri.split('/').pop()
      const invRes = await fetch(`https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=10`, {
        headers: { Authorization: `Bearer ${process.env.CALENDLY_API_KEY}` },
      })
      if (!invRes.ok) continue
      const invData = await invRes.json()
      const invitees = invData.collection || []

      for (const invitee of invitees) {
        const answers = (invitee.questions_and_answers || [])
          .map((qa: { question: string; answer: string }) => `${qa.question}: ${qa.answer}`)
          .join('\n')

        const result = await processLead({
          type: 'calendly',
          from_email: invitee.email || '',
          from_name: invitee.name || '',
          body: answers || 'No additional information provided.',
          source_account: 'calendly',
          event_type: event.name || 'Meeting',
          scheduled_time: event.start_time
            ? new Date(event.start_time).toLocaleString('en-CA', { timeZone: 'Europe/Budapest' })
            : undefined,
        })
        logs.push(`[Calendly] ${result.message}`)
      }
    }
  } catch (err) {
    logs.push(`[Calendly] ERROR: ${String(err)}`)
  }
  return logs
}

// ── Cron handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allLogs: string[] = []

  // Process Gmail
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    const logs = await processGmailAccount(process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai')
    allLogs.push(...logs)
  }

  // Process Microsoft 365
  if (process.env.MS_REFRESH_TOKEN) {
    const logs = await processMicrosoftAccount('siamak.goudarzi@nexterlaw.com')
    allLogs.push(...logs)
  }

  // Process Calendly bookings
  const calendlyLogs = await processCalendlyBookings()
  allLogs.push(...calendlyLogs)

  console.log('[Cron]', allLogs)
  return NextResponse.json({ ok: true, processed: allLogs.length, logs: allLogs })
}
