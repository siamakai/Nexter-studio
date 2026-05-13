/**
 * Smart Follow-Up Engine
 * Runs daily — scans sent emails for unanswered threads (3+ days),
 * drafts follow-ups with Claude, saves to Gmail Drafts.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const FOLLOW_UP_AFTER_DAYS = 3

interface SentEmail {
  threadId: string
  messageId: string
  to: string
  toName: string
  subject: string
  sentAt: Date
  snippet: string
}

async function getUnansweredSentEmails(gmail: ReturnType<typeof google.gmail>): Promise<SentEmail[]> {
  const cutoff = Math.floor((Date.now() - FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000) / 1000)
  const recentCutoff = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000)

  // Get sent emails from last 14 days, older than 3 days
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: `in:sent after:${recentCutoff} before:${cutoff} -label:draft`,
    maxResults: 30,
  })

  const messages = data.messages || []
  const unanswered: SentEmail[] = []

  for (const msg of messages.slice(0, 20)) {
    try {
      const { data: full } = await gmail.users.messages.get({
        userId: 'me', id: msg.id!, format: 'metadata',
        metadataHeaders: ['To', 'Subject', 'Date'],
      })

      const get = (n: string) => full.payload?.headers?.find(h => h.name?.toLowerCase() === n.toLowerCase())?.value || ''
      const to = get('To')
      const subject = get('Subject')
      const sentAt = new Date(parseInt(full.internalDate || '0'))

      // Skip if it's already a reply (Re: prefix) or automated
      if (subject.toLowerCase().startsWith('re:')) continue
      if (to.includes('noreply') || to.includes('no-reply')) continue

      // Check thread for any replies
      const { data: thread } = await gmail.users.threads.get({
        userId: 'me', id: full.threadId!, format: 'metadata',
        metadataHeaders: ['From', 'Date'],
      })

      const messages = thread.messages || []
      const myEmail = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'

      // Check if anyone replied after our sent message
      const hasReply = messages.some(m => {
        const from = m.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')?.value || ''
        const date = new Date(parseInt(m.internalDate || '0'))
        return !from.includes(myEmail) && date > sentAt
      })

      if (!hasReply) {
        const toEmail = to.match(/<(.+?)>/) ? to.match(/<(.+?)>/)![1] : to
        const toName = to.replace(/<.+>/, '').trim().replace(/"/g, '') || toEmail
        unanswered.push({
          threadId: full.threadId!,
          messageId: msg.id!,
          to: toEmail,
          toName,
          subject,
          sentAt,
          snippet: full.snippet || '',
        })
      }
    } catch { /* skip individual errors */ }
  }

  return unanswered.slice(0, 8) // max 8 follow-ups per run
}

async function draftFollowUp(
  gmail: ReturnType<typeof google.gmail>,
  email: SentEmail,
  crmContext: string
): Promise<string | null> {
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

Write ONLY the email body (no subject line, no greeting header). Keep it under 4 sentences. Be warm, not pushy. Reference the original email naturally. End with a clear soft call to action.`,
    }],
  })

  const body = (res.content[0] as { text: string }).text.trim()
  const myEmail = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`

  const rawEmail = [
    `From: ${myEmail}`,
    `To: ${email.to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${email.messageId}`,
    `References: ${email.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Hi ${email.toName.split(' ')[0]},\n\n${body}\n\nBest regards,\nSiamak Goudarzi\nFounder, Nexter AI Group`,
  ].join('\r\n')

  try {
    const { data } = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: Buffer.from(rawEmail).toString('base64url'),
          threadId: email.threadId,
        },
      },
    })
    return data.id || null
  } catch {
    return null
  }
}

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
    const tags = (c.tags || []).join(', ')
    return `${c.firstName || ''} ${c.lastName || ''} | ${c.companyName || ''} | Tags: ${tags}`
  } catch { return '' }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Gmail not connected' })

  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const unanswered = await getUnansweredSentEmails(gmail)

  if (!unanswered.length) {
    return NextResponse.json({ ok: true, message: 'No unanswered emails requiring follow-up', drafted: 0 })
  }

  const logs: string[] = []
  let drafted = 0

  for (const email of unanswered) {
    try {
      const crmContext = await getGhlContext(email.to)
      const draftId = await draftFollowUp(gmail, email, crmContext)
      if (draftId) {
        drafted++
        logs.push(`✓ Draft created for ${email.toName} — "${email.subject}"`)
      }
    } catch (err) {
      logs.push(`✗ Failed for ${email.to}: ${String(err)}`)
    }
  }

  // Send summary to inbox
  if (drafted > 0) {
    try {
      const summaryLines = logs.map(l => `  ${l}`).join('\n')
      const raw = Buffer.from([
        `To: ${process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'}`,
        `Subject: =?utf-8?B?${Buffer.from(`📬 ${drafted} Follow-Up Draft${drafted > 1 ? 's' : ''} Ready to Review`).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${drafted} follow-up email${drafted > 1 ? 's have' : ' has'} been drafted and saved to your Gmail Drafts folder.\n\nReview and send at: https://mail.google.com/#drafts\n\nDrafts created:\n${summaryLines}\n\n---\nNexter AI VA — Smart Follow-Up Engine`,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ ok: true, unanswered: unanswered.length, drafted, logs })
}
