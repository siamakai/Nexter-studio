import { graphFetch } from '@/lib/microsoft'

const MS_ACCOUNT_PROP = {
  type: 'string',
  description: 'Microsoft 365 email account to use (e.g. siamak.goudarzi@nexterlaw.com)',
}

export const microsoftTools = [
  {
    name: 'ms_read_inbox',
    description: 'Read recent emails from a Microsoft 365 / Outlook inbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: { ...MS_ACCOUNT_PROP, },
        max_results: { type: 'number', description: 'Number of emails to fetch (default 10)' },
        filter: { type: 'string', description: 'OData filter e.g. "isRead eq false"' },
        search: { type: 'string', description: 'Search query e.g. "from:client@example.com"' },
      },
      required: ['account_email'],
    },
  },
  {
    name: 'ms_send_email',
    description: 'Send an email from a Microsoft 365 / Outlook account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: MS_ACCOUNT_PROP,
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' },
        is_html: { type: 'boolean', description: 'Set true if body is HTML (default false)' },
      },
      required: ['account_email', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'ms_get_email',
    description: 'Get the full content of a specific Outlook email by message ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: MS_ACCOUNT_PROP,
        message_id: { type: 'string' },
      },
      required: ['account_email', 'message_id'],
    },
  },
  {
    name: 'ms_list_calendar',
    description: 'List upcoming events from a Microsoft 365 calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: MS_ACCOUNT_PROP,
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 7)' },
        max_results: { type: 'number', description: 'Max events to return (default 10)' },
      },
      required: ['account_email'],
    },
  },
  {
    name: 'ms_create_calendar_event',
    description: 'Create a new event in a Microsoft 365 calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: MS_ACCOUNT_PROP,
        title: { type: 'string' },
        start_datetime: { type: 'string', description: 'ISO 8601 e.g. 2026-04-25T14:00:00' },
        end_datetime: { type: 'string', description: 'ISO 8601 e.g. 2026-04-25T15:00:00' },
        timezone: { type: 'string', description: 'IANA timezone e.g. America/Toronto (default America/Toronto)' },
        description: { type: 'string' },
        attendee_email: { type: 'string' },
        location: { type: 'string', description: 'Location or Teams/Zoom meeting link' },
      },
      required: ['account_email', 'title', 'start_datetime', 'end_datetime'],
    },
  },
]

export async function execMicrosoftTool(name: string, input: Record<string, unknown>): Promise<string> {
  const email = input.account_email as string

  switch (name) {
    case 'ms_read_inbox': {
      const params = new URLSearchParams({
        $top: String(input.max_results || 10),
        $select: 'id,subject,from,receivedDateTime,isRead,bodyPreview',
        $orderby: 'receivedDateTime desc',
      })
      if (input.filter) params.set('$filter', input.filter as string)
      if (input.search) params.set('$search', `"${input.search}"`)

      const data = await graphFetch(email, `/me/messages?${params}`)
      const messages = data.value || []
      if (!messages.length) return `No emails found in ${email}.`

      return `[Account: ${email}]\n\n` + messages.map((m: Record<string, unknown>) => {
        const from = (m.from as Record<string, Record<string, string>>)?.emailAddress
        return `ID: ${m.id}\nFrom: ${from?.name || ''} <${from?.address || ''}>\nSubject: ${m.subject}\nDate: ${m.receivedDateTime}\nRead: ${m.isRead}\nPreview: ${(m.bodyPreview as string)?.slice(0, 100)}`
      }).join('\n\n---\n\n')
    }

    case 'ms_send_email': {
      await graphFetch(email, '/me/sendMail', {
        method: 'POST',
        body: JSON.stringify({
          message: {
            subject: input.subject,
            body: {
              contentType: input.is_html ? 'HTML' : 'Text',
              content: input.body,
            },
            toRecipients: [{ emailAddress: { address: input.to } }],
          },
          saveToSentItems: true,
        }),
      })
      return `Email sent from ${email} to ${input.to}`
    }

    case 'ms_get_email': {
      const msg = await graphFetch(email, `/me/messages/${input.message_id}?$select=subject,from,receivedDateTime,body`)
      const from = (msg.from as Record<string, Record<string, string>>)?.emailAddress
      const bodyContent = (msg.body as Record<string, string>)?.content || ''
      const plainBody = bodyContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      return `From: ${from?.name} <${from?.address}>\nSubject: ${msg.subject}\nDate: ${msg.receivedDateTime}\n\n${plainBody.slice(0, 2000)}`
    }

    case 'ms_list_calendar': {
      const daysAhead = (input.days_ahead as number) || 7
      const startDateTime = new Date().toISOString()
      const endDateTime = new Date(Date.now() + daysAhead * 86400000).toISOString()

      const data = await graphFetch(
        email,
        `/me/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$top=${input.max_results || 10}&$orderby=start/dateTime`
      )
      const events = data.value || []
      if (!events.length) return 'No upcoming events.'

      return events.map((e: Record<string, unknown>) => {
        const start = (e.start as Record<string, string>)?.dateTime
        const loc = (e.location as Record<string, string>)?.displayName || ''
        return `📅 ${e.subject}\n   ${new Date(start).toLocaleString()}\n   ${loc}\n   ID: ${e.id}`
      }).join('\n\n')
    }

    case 'ms_create_calendar_event': {
      const tz = (input.timezone as string) || 'America/Toronto'
      const body: Record<string, unknown> = {
        subject: input.title,
        body: { contentType: 'Text', content: input.description || '' },
        start: { dateTime: input.start_datetime, timeZone: tz },
        end: { dateTime: input.end_datetime, timeZone: tz },
        location: { displayName: input.location || '' },
      }
      if (input.attendee_email) {
        body.attendees = [{ emailAddress: { address: input.attendee_email }, type: 'required' }]
      }

      const event = await graphFetch(email, '/me/events', { method: 'POST', body: JSON.stringify(body) })
      return `Event created: "${event.subject}" on ${(event.start as Record<string, string>)?.dateTime}\nID: ${event.id}`
    }

    default:
      return `Unknown Microsoft tool: ${name}`
  }
}
