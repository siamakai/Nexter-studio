/**
 * Smart Follow-Up Engine
 * Runs daily — scans Gmail AND Outlook sent emails for unanswered threads (3+ days),
 * drafts follow-ups with Claude, saves to Gmail Drafts + Outlook Drafts.
 *
 * Priority ranking: HOT contacts are drafted first and shown at the top.
 * Escalation logic: if 3+ follow-ups already sent with no reply, stops drafting
 *   and flags the contact as needing a different approach (call / archive).
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const FOLLOW_UP_AFTER_DAYS = 3
const LOOK_BACK_DAYS       = 14
const MAX_FOLLOW_UPS       = 3   // after this many sent follow-ups with no reply → escalate

interface SentEmail {
  source:        'gmail' | 'outlook'
  threadId:      string
  messageId:     string
  to:            string
  toName:        string
  subject:       string
  sentAt:        Date
  snippet:       string
  temperature:   'hot' | 'warm' | 'cold' | 'unknown'
  crmContext:    string
  followUpCount: number  // how many times we already replied in this thread with no response
}

const TEMP_ORDER = { hot: 0, warm: 1, cold: 2, unknown: 3 }

// ── CRM context ───────────────────────────────────────────────────────────────

interface GhlData {
  context:     string
  temperature: 'hot' | 'warm' | 'cold' | 'unknown'
}

async function getGhlData(email: string): Promise<GhlData> {
  if (!process.env.GHL_API_KEY) return { context: '', temperature: 'unknown' }
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const c = data.contacts?.[0]
    if (!c) return { context: '', temperature: 'unknown' }
    const tags: string[] = (c.tags || []).map((t: string) => t.toLowerCase())
    const temperature: GhlData['temperature'] = tags.includes('hot') ? 'hot'
      : tags.includes('warm') ? 'warm'
      : tags.includes('cold') ? 'cold'
      : 'unknown'
    return {
      context: `${c.firstName || ''} ${c.lastName || ''} | ${c.companyName || ''} | Tags: ${tags.join(', ')}`,
      temperature,
    }
  } catch { return { context: '', temperature: 'unknown' } }
}

// ── Claude follow-up body ─────────────────────────────────────────────────────

async function generateFollowUpBody(email: SentEmail): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const daysAgo = Math.floor((Date.now() - email.sentAt.getTime()) / 86400000)
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a short, natural follow-up email from Dr. Siamak Goudarzi (Founder, Nexter AI Group).

Original email sent ${daysAgo} days ago to: ${email.toName} <${email.to}>
Subject: ${email.subject}
Context: ${email.snippet}
${email.crmContext ? `CRM notes: ${email.crmContext}` : ''}
${email.temperature !== 'unknown' ? `Lead temperature: ${email.temperature.toUpperCase()}` : ''}

Write ONLY the email body (no subject, no greeting header). Under 4 sentences. Warm, not pushy. Reference the original naturally. End with a soft call to action.`,
    }],
  })
  return (res.content[0] as { type: 'text'; text: string }).text.trim()
}

// ── Gmail ─────────────────────────────────────────────────────────────────────

async function getUnansweredGmail(gmail: ReturnType<typeof google.gmail>): Promise<SentEmail[]> {
  const cutoff       = Math.floor((Date.now() - FOLLOW_UP_AFTER_DAYS * 86400000) / 1000)
  const recentCutoff = Math.floor((Date.now() - LOOK_BACK_DAYS * 86400000) / 1000)
  const myEmail      = (process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai').toLowerCase()

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: `in:sent after:${recentCutoff} before:${cutoff} -label:draft`,
    maxResults: 30,
  })

  const unanswered: SentEmail[] = []

  for (const msg of (data.messages || []).slice(0, 20)) {
    try {
      const { data: full } = await gmail.users.messages.get({
        userId: 'me', id: msg.id!, format: 'metadata',
        metadataHeaders: ['To', 'Subject', 'Date'],
      })
      const get = (n: string) => full.payload?.headers?.find(h => h.name?.toLowerCase() === n.toLowerCase())?.value || ''
      const to      = get('To')
      const subject = get('Subject')
      const sentAt  = new Date(parseInt(full.internalDate || '0'))

      if (subject.toLowerCase().startsWith('re:')) continue
      if (to.includes('noreply') || to.includes('no-reply')) continue

      const { data: thread } = await gmail.users.threads.get({
        userId: 'me', id: full.threadId!, format: 'metadata',
        metadataHeaders: ['From', 'Date'],
      })

      const threadMessages = thread.messages || []
      let hasReply      = false
      let followUpCount = 0

      for (const m of threadMessages) {
        const from = (m.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')?.value || '').toLowerCase()
        const date = new Date(parseInt(m.internalDate || '0'))
        if (date <= sentAt) continue

        if (from.includes(myEmail)) {
          followUpCount++  // we sent another message after the original
        } else {
          hasReply = true  // they replied
        }
      }

      if (!hasReply) {
        const toEmail = to.match(/<(.+?)>/) ? to.match(/<(.+?)>/)![1] : to
        const toName  = to.replace(/<.+>/, '').trim().replace(/"/g, '') || toEmail
        const ghl = await getGhlData(toEmail)
        unanswered.push({
          source: 'gmail', threadId: full.threadId!, messageId: msg.id!,
          to: toEmail, toName, subject, sentAt,
          snippet: full.snippet || '',
          temperature: ghl.temperature,
          crmContext:  ghl.context,
          followUpCount,
        })
      }
    } catch { /* skip */ }
  }

  return unanswered.slice(0, 8)
}

async function saveGmailDraft(gmail: ReturnType<typeof google.gmail>, email: SentEmail, body: string): Promise<boolean> {
  const myEmail = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
  const raw = Buffer.from([
    `From: ${myEmail}`,
    `To: ${email.to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${email.messageId}`,
    `References: ${email.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Hi ${email.toName.split(' ')[0]},\n\n${body}\n\nBest regards,\nSiamak Goudarzi\nFounder, Nexter AI Group`,
  ].join('\r\n')).toString('base64url')

  try {
    await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw, threadId: email.threadId } },
    })
    return true
  } catch { return false }
}

// ── Outlook ───────────────────────────────────────────────────────────────────

async function getUnansweredOutlook(): Promise<SentEmail[]> {
  if (!process.env.MS_REFRESH_TOKEN) return []
  const OUTLOOK_EMAIL = 'siamak.goudarzi@nexterlaw.com'

  try {
    const token  = await getMsAccessToken(OUTLOOK_EMAIL)
    const cutoff = new Date(Date.now() - FOLLOW_UP_AFTER_DAYS * 86400000).toISOString()
    const since  = new Date(Date.now() - LOOK_BACK_DAYS * 86400000).toISOString()

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/sentItems/messages` +
      `?$filter=sentDateTime ge ${since} and sentDateTime le ${cutoff}` +
      `&$top=20&$select=id,subject,sentDateTime,toRecipients,conversationId,bodyPreview`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return []
    const data = await res.json()
    const unanswered: SentEmail[] = []

    for (const msg of (data.value || []).slice(0, 20)) {
      const subject = (msg.subject || '') as string
      const toAddr  = msg.toRecipients?.[0]?.emailAddress?.address || ''
      const toName  = msg.toRecipients?.[0]?.emailAddress?.name || toAddr
      const sentAt  = new Date(msg.sentDateTime)
      const convId  = msg.conversationId as string

      if (subject.toLowerCase().startsWith('re:')) continue
      if (toAddr.includes('noreply') || toAddr.includes('no-reply')) continue

      const convRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages` +
        `?$filter=conversationId eq '${convId}'` +
        `&$select=from,receivedDateTime&$orderby=receivedDateTime asc`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!convRes.ok) continue
      const convData = await convRes.json()

      let hasReply      = false
      let followUpCount = 0

      for (const m of (convData.value || [])) {
        const fromAddr = ((m.from as Record<string, Record<string, string>>)?.emailAddress?.address || '').toLowerCase()
        const date     = new Date((m.receivedDateTime as string) || 0)
        if (date <= sentAt) continue

        if (fromAddr === OUTLOOK_EMAIL.toLowerCase()) {
          followUpCount++
        } else {
          hasReply = true
        }
      }

      if (!hasReply) {
        const ghl = await getGhlData(toAddr)
        unanswered.push({
          source:    'outlook',
          threadId:  convId,
          messageId: msg.id as string,
          to:        toAddr,
          toName,
          subject,
          sentAt,
          snippet:       (msg.bodyPreview as string || '').slice(0, 200),
          temperature:   ghl.temperature,
          crmContext:    ghl.context,
          followUpCount,
        })
      }
    }

    return unanswered.slice(0, 5)
  } catch { return [] }
}

async function saveOutlookDraft(email: SentEmail, body: string): Promise<boolean> {
  if (!process.env.MS_REFRESH_TOKEN) return false
  try {
    const token = await getMsAccessToken('siamak.goudarzi@nexterlaw.com')
    const replyRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${email.messageId}/createReply`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }
    )
    if (!replyRes.ok) return false
    const draft = await replyRes.json()
    const fullBody = `Hi ${email.toName.split(' ')[0]},\n\n${body}\n\nBest regards,\nSiamak Goudarzi\nFounder, Nexter AI Group`
    const patchRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draft.id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { contentType: 'Text', content: fullBody } }),
      }
    )
    return patchRes.ok
  } catch { return false }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Gmail not connected' })

  const auth  = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const [gmailUnanswered, outlookUnanswered] = await Promise.all([
    getUnansweredGmail(gmail),
    getUnansweredOutlook(),
  ])

  // Sort by priority: hot → warm → cold → unknown
  const allUnanswered = [...gmailUnanswered, ...outlookUnanswered]
    .sort((a, b) => TEMP_ORDER[a.temperature] - TEMP_ORDER[b.temperature])

  if (!allUnanswered.length) {
    return NextResponse.json({ ok: true, message: 'No unanswered emails requiring follow-up', drafted: 0 })
  }

  const logs: string[] = []
  const escalations: string[] = []
  let drafted = 0

  for (const email of allUnanswered) {
    // Escalation: 3+ follow-ups sent, no reply — stop drafting, flag instead
    if (email.followUpCount >= MAX_FOLLOW_UPS) {
      escalations.push(`⛔ ESCALATION — ${email.toName} <${email.to}> [${email.temperature.toUpperCase()}]: ${email.followUpCount} follow-ups sent, no reply. Consider calling or archiving.`)
      continue
    }

    try {
      const body  = await generateFollowUpBody(email)
      const saved = email.source === 'gmail'
        ? await saveGmailDraft(gmail, email, body)
        : await saveOutlookDraft(email, body)

      if (saved) {
        drafted++
        const tempIcon = { hot: '🔥', warm: '🌡️', cold: '❄️', unknown: '•' }[email.temperature]
        logs.push(`✓ ${tempIcon} [${email.temperature.toUpperCase()}] [${email.source.toUpperCase()}] ${email.toName} — "${email.subject}" (${email.followUpCount} prior follow-up${email.followUpCount !== 1 ? 's' : ''})`)
      }
    } catch (err) {
      logs.push(`✗ Failed for ${email.to}: ${String(err)}`)
    }
  }

  // Send summary email grouped by priority
  if (drafted > 0 || escalations.length > 0) {
    try {
      const hotLogs  = logs.filter(l => l.includes('[HOT]'))
      const warmLogs = logs.filter(l => l.includes('[WARM]'))
      const coldLogs = logs.filter(l => l.includes('[COLD]') || l.includes('[UNKNOWN]') || (!l.includes('[HOT]') && !l.includes('[WARM]') && !l.includes('[COLD]')))

      const sections: string[] = []
      if (escalations.length) {
        sections.push(`⛔ ESCALATION NEEDED (${escalations.length} contacts — change approach)\n${escalations.map(e => `  ${e}`).join('\n')}`)
      }
      if (hotLogs.length)  sections.push(`🔥 HOT PRIORITY (${hotLogs.length})\n${hotLogs.map(l => `  ${l}`).join('\n')}`)
      if (warmLogs.length) sections.push(`🌡️ WARM (${warmLogs.length})\n${warmLogs.map(l => `  ${l}`).join('\n')}`)
      if (coldLogs.length) sections.push(`❄️ COLD / OTHER (${coldLogs.length})\n${coldLogs.map(l => `  ${l}`).join('\n')}`)

      const body = [
        `${drafted} follow-up draft${drafted !== 1 ? 's' : ''} created${escalations.length ? ` + ${escalations.length} escalation${escalations.length !== 1 ? 's' : ''} flagged` : ''}.`,
        '',
        sections.join('\n\n'),
        '',
        `Gmail drafts:   https://mail.google.com/#drafts`,
        `Outlook drafts: https://outlook.office.com/mail/drafts`,
        '',
        '---',
        'Nexter AI VA — Smart Follow-Up Engine',
      ].join('\n')

      const raw = Buffer.from([
        `To: ${process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'}`,
        `Subject: =?utf-8?B?${Buffer.from(`📬 ${drafted} Follow-Up Draft${drafted !== 1 ? 's' : ''} Ready${escalations.length ? ` + ${escalations.length} Escalation${escalations.length !== 1 ? 's' : ''}` : ''}`).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        body,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch { /* non-critical */ }
  }

  return NextResponse.json({
    ok: true,
    gmail: gmailUnanswered.length,
    outlook: outlookUnanswered.length,
    drafted,
    escalations: escalations.length,
    logs: [...escalations, ...logs],
  })
}
