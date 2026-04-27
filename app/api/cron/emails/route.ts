import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getMsAccessToken } from '@/lib/microsoft'
import { processLead } from '@/lib/lead-processor'

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

// ── Cron handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allLogs: string[] = []

  // Process Gmail accounts
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    const logs = await processGmailAccount(process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai')
    allLogs.push(...logs)
  }

  // Process Microsoft accounts
  if (process.env.MS_REFRESH_TOKEN) {
    const logs = await processMicrosoftAccount('siamak.goudarzi@nexterlaw.com')
    allLogs.push(...logs)
  }

  console.log('[Email cron]', allLogs)
  return NextResponse.json({ ok: true, processed: allLogs.length, logs: allLogs })
}
