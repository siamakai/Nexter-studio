import { NextRequest, NextResponse } from 'next/server'
import { processLead } from '@/lib/lead-processor'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Only process new bookings
    if (body.event !== 'invitee.created') {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const payload = body.payload || {}
    const invitee = payload.invitee || {}
    const scheduledEvent = payload.scheduled_event || {}
    const eventType = payload.event_type || {}

    // Extract answers to custom questions (e.g. phone, company, message)
    const answers: string[] = (payload.questions_and_answers || []).map(
      (qa: { question: string; answer: string }) => `${qa.question}: ${qa.answer}`
    )

    const result = await processLead({
      type: 'calendly',
      from_email: invitee.email || '',
      from_name: invitee.name || '',
      body: answers.join('\n') || 'No additional information provided.',
      source_account: 'calendly',
      event_type: eventType.name || scheduledEvent.name || 'Meeting',
      scheduled_time: scheduledEvent.start_time
        ? new Date(scheduledEvent.start_time).toLocaleString('en-CA', { timeZone: 'America/Toronto' })
        : undefined,
    })

    console.log('[Calendly webhook]', result.message)
    return NextResponse.json({ ok: true, result: result.message })
  } catch (err) {
    console.error('[Calendly webhook error]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
