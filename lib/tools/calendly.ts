const CALENDLY_BASE = 'https://api.calendly.com'
const TZ = 'Europe/Paris'
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

async function calendlyGet(path: string) {
  const res = await fetch(`${CALENDLY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Calendly API error ${res.status}: ${await res.text()}`)
  return res.json()
}

export const calendlyTools = [
  {
    name: 'calendly_list_events',
    description: 'List upcoming scheduled Calendly meetings/bookings. Returns invitee name, email, event time, and event type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Number of events to return (default 10)' },
        status: { type: 'string', description: 'Filter by status: active or canceled (default: active)' },
      },
    },
  },
  {
    name: 'calendly_get_invitee',
    description: 'Get full details for a specific Calendly event including invitee name, email, questions answered, and event time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_uuid: { type: 'string', description: 'Calendly event UUID' },
      },
      required: ['event_uuid'],
    },
  },
]

export async function execCalendlyTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (!process.env.CALENDLY_API_KEY) {
    return 'Calendly not connected. Add CALENDLY_API_KEY to environment variables.'
  }

  switch (name) {
    case 'calendly_list_events': {
      // First get the current user to get their URI
      const me = await calendlyGet('/users/me')
      const userUri = me.resource.uri

      const count = (input.count as number) || 10
      const status = (input.status as string) || 'active'
      const now = new Date().toISOString()

      const data = await calendlyGet(
        `/scheduled_events?user=${encodeURIComponent(userUri)}&count=${count}&status=${status}&min_start_time=${now}&sort=start_time:asc`
      )

      if (!data.collection?.length) return 'No upcoming Calendly events.'

      return data.collection.map((e: Record<string, unknown>) => {
        const name = (e.name as string) || 'Meeting'
        const start = e.start_time as string
        const end = e.end_time as string
        const uuid = (e.uri as string).split('/').pop()
        const location = (e.location as Record<string, string>)?.join_url || (e.location as Record<string, string>)?.location || 'TBD'
        return `📅 ${name}\n   Start: ${fmtTime(start)}\n   End: ${fmtTime(end)}\n   Location: ${location}\n   UUID: ${uuid}`
      }).join('\n\n')
    }

    case 'calendly_get_invitee': {
      const eventUuid = input.event_uuid as string
      const [eventData, inviteesData] = await Promise.all([
        calendlyGet(`/scheduled_events/${eventUuid}`),
        calendlyGet(`/scheduled_events/${eventUuid}/invitees`),
      ])

      const event = eventData.resource
      const invitees = inviteesData.collection || []
      const invitee = invitees[0] || {}

      const location = event.location?.join_url || event.location?.location || 'TBD'

      return [
        `Event: ${event.name}`,
        `Start: ${fmtTime(event.start_time as string)}`,
        `End: ${fmtTime(event.end_time as string)}`,
        `Location/Link: ${location}`,
        `Invitee: ${invitee.name || 'Unknown'} <${invitee.email || 'Unknown'}>`,
        `Status: ${invitee.status || event.status}`,
        `UUID: ${eventUuid}`,
      ].join('\n')
    }

    default:
      return `Unknown Calendly tool: ${name}`
  }
}
