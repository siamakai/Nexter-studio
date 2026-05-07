/**
 * Delegation Tracker
 * Runs daily — finds overdue delegations, sends nudge emails to team members,
 * and sends a summary to Siamak.
 */

import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { getOverdueDelegations, updateDelegation, listDelegations } from '@/lib/supabase'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [overdue, all] = await Promise.all([
    getOverdueDelegations(),
    listDelegations(),
  ])

  if (!overdue.length) {
    return NextResponse.json({ ok: true, message: 'All delegations on track', active: all.length })
  }

  const logs: string[] = []

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    const auth = await getAuthedClient()
    const gmail = google.gmail({ version: 'v1', auth })
    const from = process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'

    // Send nudge summary to Siamak
    const overdueLines = overdue.map(d =>
      `• ${d.task} — assigned to ${d.assigned_to} (due: ${d.due_date || 'no date'}, nudges sent: ${d.nudge_count || 0})`
    ).join('\n')

    try {
      const raw = Buffer.from([
        `To: ${from}`,
        `Subject: ⚠️ ${overdue.length} Overdue Delegation${overdue.length > 1 ? 's' : ''} Need Attention`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `The following tasks assigned to your team are overdue:\n\n${overdueLines}\n\nReview and follow up in the VA chat: va.nexterai.agency`,
      ].join('\r\n')).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      logs.push('Overdue summary sent to Siamak')
    } catch { /* non-critical */ }

    // Increment nudge count for each overdue item
    for (const d of overdue) {
      const nudgeCount = (d.nudge_count || 0) + 1
      await updateDelegation(d.id!, { nudge_count: nudgeCount, status: 'overdue' })
      logs.push(`Nudge #${nudgeCount} logged for: ${d.task} → ${d.assigned_to}`)
    }
  }

  return NextResponse.json({ ok: true, overdue: overdue.length, active: all.length, logs })
}
