/**
 * Smart Follow-Up Engine
 * Runs daily — scans Gmail AND Outlook sent emails for unanswered threads (3+ days),
 * drafts follow-ups with Claude, saves to Gmail Drafts + Outlook Drafts.
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

interface SentEmail {
  source:    'gmail' | 'outlook'
  threadId:  string        // Gmail threadId or Outlook conversationId
  messageId: string        // Gmail msgId or Outlook message id
  to:        string
  toName:    string
  subject:   string
  sentAt:    Date
  snippet:   string
}

// ── CRM context ───────────────────────────────────────────────────────────────

async function getGhlContext(email: string): Promise<string> {
  if (!process.env.GHL_API_KEY) return ''
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
    )
    const data = await res.json()
    const c = data.contacts?.[0]
    if (!c) return ''
    return `${c.firstName || ''} ${c.lastName || ''} | ${c.companyName || ''} | Tags: ${(c.tags || []).join(', ')}`
  } catch { return '' }
}

// ── Claude follow-up body ─────────────────────────────────────────────────────

async function generateFollowUpBody(email: SentEmail, crmContext: string): Promise<string> {
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
${crmContext ? `CRM notes: ${crmContext}` : ''}

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
      const hasReply = (thread.messages || []).some(m => {
        const from = (m.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')?.value || '').toLowerCase()
        const date  = new Date(parseInt(m.internalDate || '0'))
        return !from.includes(myEmail) && date > sentAt
      })

      if (!hasReply) {
        const toEmail = to.match(/<(.+?)>/) ? to.match(/<(.+?)>/)![1] : to
        const toName  = to.replace(/<.+>/, '').trim().replace(/"/g, '') || toEmail
        unanswered.push({ source: 'gmail', threadId: full.threadId!, messageId: msg.id!, to: toEmail, toName, subject, sentAt, snippet: full.snippet || '' })
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
      const subject    = (msg.subject || '') as string
      const toAddr     = msg.toRecipients?.[0]?.emailAddress?.address || ''
      const toName     = msg.toRecipients?.[0]?.emailAddress?.name || toAddr
      const sentAt     = new Date(msg.sentDateTime)
      const convId     = msg.conversationId as string

      if (subject.toLowerCase().startsWith('re:')) continue
      if (toAddr.includes('noreply') || toAddr.includes('no-reply')) continue

      // Check conversation for any reply after our sent message
      const convRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages` +
        `?$filter=conversationId eq '${convId}'` +
        `&$select=from,receivedDateTime&$orderby=receivedDateTime asc`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!convRes.ok) continue
      const convData = await convRes.json()

      const hasReply = (convData.value || []).some((m: Record<string, unknown>) => {
        const fromAddr = (((m as Record<string, unknown>).from as Record<string, Record<string, string>>)?.emailAddress?.address || '').toLowerCase()
        const date     = new Date(((m as Record<string, unknown>).receivedDateTime as string) || 0)
        return fromAddr !== OUTLOOK_EMAIL.toLowerCase() && date > sentAt
      })

      if (!hasReply) {
        unanswered.push({
          source:    'outlook',
          threadId:  convId,
          messageId: msg.id as string,
          to:        toAddr,
          toName,
          subject,
          sentAt,
          snippet:   (msg.bodyPreview as string || '').slice(0, 200),
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

    // Create reply draft on the original message
    const replyRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${email.messageId}/createReply`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }
    )
    if (!replyRes.ok) return false
    const draft = await replyRes.json()

    // Update draft body
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

  // Scan both inboxes in parallel
  const [gmailUnanswered, outlookUnanswered] = await Promise.all([
    getUnansweredGmail(gmail),
    getUnansweredOutlook(),
  ])

  const allUnanswered = [...gmailUnanswered, ...outlookUnanswered]

  if (!allUnanswered.length) {
    return NextResponse.json({ ok: true, message: 'No unanswered emails requiring follow-up', drafted: 0 })
  }

  const logs: string[] = []
  let drafted = 0

  for (const email of allUnanswered) {
    try {
      const crmContext = await getGhlContext(email.to)
      const body       = await generateFollowUpBody(email, crmContext)

      const saved = email.source === 'gmail'
        ? await saveGmailDraft(gmail, email, body)
        : await saveOutlookDraft(email, body)

      if (saved) {
        drafted++
        logs.push(`✓ [${email.source.toUpperCase()}] Draft for ${email.toName} — "${email.subject}"`)
      }
    } catch (err) {
      logs.push(`✗ Failed for ${email.to}: ${String(err)}`)
    }
  }

  // Send summary email
  if (drafted > 0) {
    try {
      const raw = Buffer.from([
        `To: ${process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'}`,
        `Subject: =?utf-8?B?${Buffer.from(`📬 ${drafted} Follow-Up Draft${drafted > 1 ? 's' : ''} Ready to Review`).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${drafted} follow-up email${drafted > 1 ? 's have' : ' has'} been drafted across Gmail and Outlook.\n\nGmail drafts: https://mail.google.com/#drafts\nOutlook drafts: https://outlook.office.com/mail/drafts\n\nDrafts created:\n${logs.map(l => `  ${l}`).join('\n')}\n\n---\nNexter AI VA — Smart Follow-Up Engine`,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ ok: true, gmail: gmailUnanswered.length, outlook: outlookUnanswered.length, drafted, logs })
}
