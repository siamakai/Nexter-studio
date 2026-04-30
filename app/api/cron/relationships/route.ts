/**
 * Relationship Health Monitor
 * Runs daily — finds GHL contacts with no activity in 30/60/90 days,
 * drafts tiered re-engagement emails and saves to Gmail Drafts.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

interface StaleContact {
  id: string; name: string; email: string; company: string
  tags: string[]; daysInactive: number; tier: '30' | '60' | '90'
}

async function getStaleContacts(): Promise<StaleContact[]> {
  if (!process.env.GHL_API_KEY) return []

  const res = await fetch(
    `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=100&sortBy=dateUpdated&sortDirection=asc`,
    { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
  )
  const data = await res.json()
  const now = Date.now()
  const stale: StaleContact[] = []

  for (const c of data.contacts || []) {
    if (!c.email) continue
    const tags: string[] = c.tags || []
    // Only track contacts we care about (had some engagement)
    if (!tags.some((t: string) => ['hot', 'warm', 'client', 'prospect', 'lead'].includes(t.toLowerCase()))) continue

    const lastActivity = new Date((c.dateUpdated || c.dateAdded) as string).getTime()
    const daysInactive = Math.floor((now - lastActivity) / 86400000)

    if (daysInactive < 30) continue

    const tier = daysInactive >= 90 ? '90' : daysInactive >= 60 ? '60' : '30'
    stale.push({
      id: c.id,
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      email: c.email,
      company: c.companyName || '',
      tags,
      daysInactive,
      tier,
    })
  }

  // Max 5 per run to avoid spam
  return stale.sort((a, b) => b.daysInactive - a.daysInactive).slice(0, 5)
}

function getTierMessage(tier: '30' | '60' | '90', contact: StaleContact): string {
  const firstName = contact.name.split(' ')[0] || 'there'
  if (tier === '30') {
    return `Hi ${firstName},\n\nI wanted to check in and see how things are going. We've been working on some exciting developments at Nexter AI that I thought you might find relevant.\n\nWould love to reconnect — are you available for a quick 15-minute call this week?\n\nBest,\nSiamak`
  }
  if (tier === '60') {
    return `Hi ${firstName},\n\nIt's been a while since we last connected and I wanted to reach out with something that might be valuable for you.\n\nWe've recently launched new AI automation capabilities specifically designed for ${contact.company || 'businesses like yours'} that are saving our clients significant time and revenue. I'd love to show you what's possible.\n\nWould you be open to a brief demo call?\n\nBest,\nSiamak Goudarzi\nFounder, Nexter AI Group`
  }
  // 90 day — re-engagement
  return `Hi ${firstName},\n\nI know it's been some time since we last spoke, so I'll keep this brief.\n\nWe've helped several companies in your space dramatically improve their operations with AI — and I genuinely think we could do the same for ${contact.company || 'your business'}.\n\nIf the timing isn't right, no worries at all. But if you have 20 minutes sometime this month, I'd love to reconnect.\n\nEither way, I hope things are going well.\n\nWarm regards,\nSiamak`
}

async function draftReEngagement(
  gmail: ReturnType<typeof google.gmail>,
  contact: StaleContact,
  anthropic: Anthropic
): Promise<boolean> {
  // Personalize with Claude if we have company context
  let body = getTierMessage(contact.tier, contact)

  if (contact.company) {
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: `Lightly personalize this re-engagement email for ${contact.name} at ${contact.company}. Keep the same structure and tone. Only change 1-2 sentences to reference their company/industry. Tags about them: ${contact.tags.join(', ')}. Return ONLY the email body, no subject.

${body}`,
        }],
      })
      body = (res.content[0] as { text: string }).text.trim()
    } catch { /* use template */ }
  }

  const tierLabel = { '30': '30-Day Check-in', '60': '60-Day Value Offer', '90': '90-Day Re-engagement' }[contact.tier]
  const subject = contact.tier === '90'
    ? `Checking in — ${contact.name}`
    : `Quick note — ${contact.company || contact.name}`

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
    console.log(`[relationships] Draft created: ${tierLabel} for ${contact.name} (${contact.daysInactive}d inactive)`)
    return true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.GOOGLE_REFRESH_TOKEN) return NextResponse.json({ ok: false, message: 'Gmail not connected' })

  const stale = await getStaleContacts()

  if (!stale.length) {
    return NextResponse.json({ ok: true, message: 'All contacts are active — no re-engagement needed', drafted: 0 })
  }

  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let drafted = 0
  const logs: string[] = []

  for (const contact of stale) {
    const ok = await draftReEngagement(gmail, contact, anthropic)
    if (ok) {
      drafted++
      logs.push(`✓ ${contact.tier}-day draft: ${contact.name} <${contact.email}> (${contact.daysInactive}d inactive)`)
    }
  }

  // Notify
  if (drafted > 0) {
    try {
      const raw = Buffer.from([
        `To: ${process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'}`,
        `Subject: 💼 ${drafted} Relationship Re-engagement Draft${drafted > 1 ? 's' : ''} Ready`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${drafted} re-engagement email${drafted > 1 ? 's have' : ' has'} been drafted for inactive contacts.\n\nReview at: https://mail.google.com/#drafts\n\n${logs.join('\n')}\n\n---\nNexter AI VA — Relationship Health Monitor`,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ ok: true, staleFound: stale.length, drafted, logs })
}
