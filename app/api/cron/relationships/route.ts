/**
 * Relationship Health Monitor
 * Runs daily — finds GHL contacts with no activity in 30/60/90 days,
 * drafts tiered re-engagement emails and saves to Gmail or Outlook Drafts.
 *
 * Outlook routing: contacts tagged "nexterlaw" or "outlook-inquiry" get
 *   their draft saved to Outlook Drafts instead of Gmail.
 *
 * Close the loop: tracks attempt count via GHL tags (nurture-1/2/3).
 *   After 3 drafts with no response, tags the contact "nurture-review"
 *   and flags them in the summary email instead of drafting again.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

interface StaleContact {
  id:          string
  name:        string
  email:       string
  company:     string
  tags:        string[]
  daysInactive: number
  tier:        '30' | '60' | '90'
  useOutlook:  boolean   // true = draft goes to Outlook instead of Gmail
  nurtureCount: number   // how many drafts already sent (tracked via nurture-N tags)
}

// ── GHL contact fetch ─────────────────────────────────────────────────────────

async function getStaleContacts(): Promise<StaleContact[]> {
  if (!process.env.GHL_API_KEY) return []

  const now    = Date.now()
  const stale: StaleContact[] = []
  let startAfter: string | null = null
  let page = 0

  while (page < 5) {
    const url = new URL('https://services.leadconnectorhq.com/contacts/')
    url.searchParams.set('locationId', process.env.GHL_LOCATION_ID || '')
    url.searchParams.set('limit', '100')
    url.searchParams.set('sortBy', 'dateUpdated')
    url.searchParams.set('sortDirection', 'asc')
    if (startAfter) url.searchParams.set('startAfter', startAfter)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' },
    })
    if (!res.ok) break
    const data = await res.json()
    const contacts = data.contacts || []
    if (!contacts.length) break

    const ownDomains = ['i-review.ai', 'nexterai.agency', 'nexterlaw.com']
    const ownEmails  = ['info@i-review.ai', 'siamak.goudarzi@nexterlaw.com']

    for (const c of contacts) {
      if (!c.email) continue
      const email = (c.email as string).toLowerCase()
      if (ownEmails.includes(email) || ownDomains.some(d => email.endsWith(`@${d}`))) continue

      const tags: string[] = (c.tags || []).map((t: string) => t.toLowerCase())
      if (!tags.some(t => ['hot', 'warm', 'client', 'prospect', 'lead'].includes(t))) continue

      const lastActivity = new Date((c.dateAdded || c.dateUpdated) as string).getTime()
      const daysInactive = Math.floor((now - lastActivity) / 86400000)
      if (daysInactive < 30) continue

      const tier: '30' | '60' | '90' = daysInactive >= 90 ? '90' : daysInactive >= 60 ? '60' : '30'

      const useOutlook  = tags.some(t => ['nexterlaw', 'outlook-inquiry'].includes(t))
      const nurtureCount = tags.includes('nurture-3') ? 3
        : tags.includes('nurture-2') ? 2
        : tags.includes('nurture-1') ? 1
        : 0

      stale.push({
        id: c.id,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        email: c.email,
        company: c.companyName || '',
        tags,
        daysInactive,
        tier,
        useOutlook,
        nurtureCount,
      })
    }

    if (contacts.length < 100) break
    startAfter = contacts[contacts.length - 1]?.id
    page++
  }

  return stale.sort((a, b) => b.daysInactive - a.daysInactive)
}

// ── Nurture count tracking via GHL tags ───────────────────────────────────────

async function incrementNurtureTag(contact: StaleContact): Promise<void> {
  if (!process.env.GHL_API_KEY) return
  const nextCount = contact.nurtureCount + 1
  const newTag    = `nurture-${nextCount}`
  const merged    = Array.from(new Set([...contact.tags, newTag]))
  try {
    await fetch(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: merged }),
    })
  } catch { /* non-critical */ }
}

async function flagForReview(contact: StaleContact): Promise<void> {
  if (!process.env.GHL_API_KEY) return
  const merged = Array.from(new Set([...contact.tags, 'nurture-review', 'needs-manual-review']))
  try {
    await fetch(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: merged }),
    })
  } catch { /* non-critical */ }
}

// ── Dedup — already drafted today? ────────────────────────────────────────────

async function alreadyDraftedToday(
  gmail: ReturnType<typeof google.gmail>,
  email: string,
): Promise<boolean> {
  try {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: `in:draft to:${email} after:${todayStr}`,
      maxResults: 1,
    })
    return (data.messages?.length || 0) > 0
  } catch {
    return false
  }
}

// ── Email body templates ──────────────────────────────────────────────────────

function getTierMessage(tier: '30' | '60' | '90', contact: StaleContact): string {
  const firstName = contact.name.split(' ')[0] || 'there'
  if (tier === '30') {
    return `Hi ${firstName},\n\nI wanted to check in and see how things are going. We've been working on some exciting developments at Nexter AI that I thought you might find relevant.\n\nWould love to reconnect — are you available for a quick 15-minute call this week?\n\nBest,\nSiamak`
  }
  if (tier === '60') {
    return `Hi ${firstName},\n\nIt's been a while since we last connected and I wanted to reach out with something that might be valuable for you.\n\nWe've recently launched new AI automation capabilities specifically designed for ${contact.company || 'businesses like yours'} that are saving our clients significant time and revenue. I'd love to show you what's possible.\n\nWould you be open to a brief demo call?\n\nBest,\nSiamak Goudarzi\nFounder, Nexter AI Group`
  }
  return `Hi ${firstName},\n\nI know it's been some time since we last spoke, so I'll keep this brief.\n\nWe've helped several companies in your space dramatically improve their operations with AI — and I genuinely think we could do the same for ${contact.company || 'your business'}.\n\nIf the timing isn't right, no worries at all. But if you have 20 minutes sometime this month, I'd love to reconnect.\n\nEither way, I hope things are going well.\n\nWarm regards,\nSiamak`
}

// ── Gmail draft ───────────────────────────────────────────────────────────────

async function saveGmailDraft(
  gmail: ReturnType<typeof google.gmail>,
  contact: StaleContact,
  body: string,
  subject: string,
): Promise<boolean> {
  const myEmail = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
  const rawEmail = [
    `From: ${myEmail}`,
    `To: ${contact.email}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
  try {
    await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: Buffer.from(rawEmail).toString('base64url') } },
    })
    return true
  } catch {
    return false
  }
}

// ── Outlook draft ─────────────────────────────────────────────────────────────

async function saveOutlookDraft(
  contact: StaleContact,
  body: string,
  subject: string,
): Promise<boolean> {
  if (!process.env.MS_REFRESH_TOKEN) return false
  try {
    const token = await getMsAccessToken('siamak.goudarzi@nexterlaw.com')
    const res = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        isDraft: true,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: contact.email } }],
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Draft a single re-engagement ──────────────────────────────────────────────

async function draftReEngagement(
  gmail: ReturnType<typeof google.gmail>,
  contact: StaleContact,
  anthropic: Anthropic,
): Promise<'drafted' | 'skipped_today' | 'error'> {
  if (await alreadyDraftedToday(gmail, contact.email)) return 'skipped_today'

  let body = getTierMessage(contact.tier, contact)

  if (contact.company) {
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: `Lightly personalize this re-engagement email for ${contact.name} at ${contact.company}. Keep the same structure and tone. Only change 1-2 sentences to reference their company/industry. Tags: ${contact.tags.join(', ')}. Return ONLY the email body, no subject.\n\n${body}`,
        }],
      })
      body = (res.content[0] as { text: string }).text.trim()
    } catch { /* use template */ }
  }

  const subject = contact.tier === '90'
    ? `Checking in — ${contact.name}`
    : `Quick note — ${contact.company || contact.name}`

  const saved = contact.useOutlook
    ? await saveOutlookDraft(contact, body, subject)
    : await saveGmailDraft(gmail, contact, body, subject)

  if (saved) {
    await incrementNurtureTag(contact)
    return 'drafted'
  }
  return 'error'
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Gmail not connected' })

  const stale = await getStaleContacts()

  if (!stale.length) {
    return NextResponse.json({ ok: true, message: 'All contacts are active — no re-engagement needed', drafted: 0 })
  }

  const auth     = await getAuthedClient()
  const gmail    = google.gmail({ version: 'v1', auth })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  // Separate contacts that need escalation from those to draft
  const toEscalate = stale.filter(c => c.nurtureCount >= 3 && !c.tags.includes('nurture-review'))
  const toDraft    = stale.filter(c => c.nurtureCount < 3).slice(0, 5)

  const logs:        string[] = []
  const escalations: string[] = []
  let drafted = 0

  // Flag escalations in GHL
  for (const contact of toEscalate.slice(0, 10)) {
    await flagForReview(contact)
    const temp = contact.tags.includes('hot') ? '🔥 HOT'
      : contact.tags.includes('warm') ? '🌡️ WARM' : '•'
    escalations.push(`${temp} ${contact.name} <${contact.email}> (${contact.daysInactive}d inactive, 3 unanswered nurture emails) — tagged nurture-review`)
  }

  // Draft re-engagements for remaining contacts
  for (const contact of toDraft) {
    const result = await draftReEngagement(gmail, contact, anthropic)
    const dest   = contact.useOutlook ? 'Outlook' : 'Gmail'
    const tier   = { '30': '30-Day Check-in', '60': '60-Day Value Offer', '90': '90-Day Re-engagement' }[contact.tier]
    if (result === 'drafted') {
      drafted++
      logs.push(`✓ [${dest}] ${tier} #${contact.nurtureCount + 1}: ${contact.name} <${contact.email}> (${contact.daysInactive}d inactive)`)
    } else if (result === 'skipped_today') {
      logs.push(`⏭ Already drafted today: ${contact.name}`)
    } else {
      logs.push(`✗ Draft failed: ${contact.name} <${contact.email}>`)
    }
  }

  // Summary notification
  if (drafted > 0 || escalations.length > 0) {
    try {
      const sections: string[] = []

      if (escalations.length) {
        sections.push(
          `⛔ CLOSE THE LOOP — ${escalations.length} contact${escalations.length !== 1 ? 's' : ''} with 3 unanswered nurture emails:\n` +
          escalations.map(e => `  ${e}`).join('\n') +
          `\n\nRecommended action: call them, move to a different pipeline stage, or archive.\nTagged "nurture-review" in GHL — review at: https://app.gohighlevel.com/`
        )
      }

      if (drafted > 0) {
        const gmailDrafts   = logs.filter(l => l.includes('[Gmail]'))
        const outlookDrafts = logs.filter(l => l.includes('[Outlook]'))
        if (gmailDrafts.length)   sections.push(`Gmail Drafts (${gmailDrafts.length}):\n${gmailDrafts.map(l => `  ${l}`).join('\n')}`)
        if (outlookDrafts.length) sections.push(`Outlook Drafts (${outlookDrafts.length}):\n${outlookDrafts.map(l => `  ${l}`).join('\n')}`)
      }

      const subject = escalations.length && drafted === 0
        ? `⛔ ${escalations.length} Relationship${escalations.length !== 1 ? 's' : ''} Need Closing — No More Drafts`
        : `💼 ${drafted} Re-engagement Draft${drafted !== 1 ? 's' : ''} Ready${escalations.length ? ` + ${escalations.length} Escalation${escalations.length !== 1 ? 's' : ''}` : ''}`

      const raw = Buffer.from([
        `To: ${process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'}`,
        `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        sections.join('\n\n') +
          (drafted > 0 ? `\n\nGmail Drafts:   https://mail.google.com/#drafts\nOutlook Drafts: https://outlook.office.com/mail/drafts` : '') +
          '\n\n---\nNexter AI VA — Relationship Health Monitor',
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch { /* non-critical */ }
  }

  return NextResponse.json({
    ok: true,
    staleFound: stale.length,
    drafted,
    escalated: escalations.length,
    logs: [...escalations.map(e => `⛔ ESCALATION: ${e}`), ...logs],
  })
}
