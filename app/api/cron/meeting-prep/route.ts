import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const TZ = 'Europe/Budapest'

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, message: 'Google Calendar not connected' })
  }

  // Find meetings starting in the next 25–35 minutes
  const now = Date.now()
  const windowStart = new Date(now + 25 * 60 * 1000)
  const windowEnd = new Date(now + 35 * 60 * 1000)

  let upcomingEvents: Record<string, unknown>[] = []
  try {
    const auth = await getAuthedClient()
    const cal = google.calendar({ version: 'v3', auth })
    const { data } = await cal.events.list({
      calendarId: 'primary',
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
    })
    upcomingEvents = (data.items || []) as Record<string, unknown>[]
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) })
  }

  if (!upcomingEvents.length) {
    return NextResponse.json({ ok: true, message: 'No meetings in the next 30 minutes' })
  }

  const logs: string[] = []
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  for (const event of upcomingEvents) {
    const attendees = ((event.attendees as { email: string; self?: boolean }[]) || [])
      .filter(a => !a.self)
      .map(a => a.email)
      .filter(e => !e.includes('resource.calendar.google'))

    const startTime = new Date((event.start as Record<string, string>)?.dateTime || '').toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    const contextLines: string[] = []

    // CRM lookup for each attendee
    for (const email of attendees.slice(0, 3)) {
      if (process.env.GHL_API_KEY) {
        try {
          const res = await fetch(
            `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(email)}&limit=1`,
            { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
          )
          const data = await res.json()
          const c = data.contacts?.[0]
          if (c) {
            contextLines.push(`CRM — ${c.firstName || ''} ${c.lastName || ''} | ${c.companyName || 'no company'} | Tags: ${(c.tags || []).join(', ') || 'none'}`)
          }
        } catch { /* skip */ }
      }

      // Last Gmail thread with this person
      try {
        const auth = await getAuthedClient()
        const gmail = google.gmail({ version: 'v1', auth })
        const { data } = await gmail.users.messages.list({ userId: 'me', q: `from:${email} OR to:${email}`, maxResults: 1 })
        if (data.messages?.length) {
          const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: data.messages[0].id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })
          const get = (n: string) => msg.payload?.headers?.find(h => h.name === n)?.value || ''
          contextLines.push(`Last email — "${get('Subject')}" on ${get('Date')}`)
        }
      } catch { /* skip */ }
    }

    const brief = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write a 30-second meeting prep brief for Dr. Siamak Goudarzi.

Meeting: ${event.summary as string}
Starts at: ${startTime}
Location/link: ${(event.location as string) || (event.hangoutLink as string) || 'None set'}
Attendees: ${attendees.join(', ') || 'Not specified'}

Context:
${contextLines.join('\n') || 'No prior history found for this contact.'}

Write 3–4 bullet points. What to know, what to remember, what to aim for in this call.
Plain text only. Be concise and sharp.`,
      }],
    })

    const briefText = (brief.content[0] as { type: 'text'; text: string }).text

    // Send prep email
    try {
      const auth = await getAuthedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const to = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
      const subject = `Meeting in 30min: ${event.summary as string} (${startTime})`
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', briefText].join('\r\n')
      ).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      logs.push(`Prep sent for: ${event.summary as string}`)
    } catch (err) {
      logs.push(`Email error for "${event.summary as string}": ${String(err)}`)
    }
  }

  return NextResponse.json({ ok: true, logs })
}
