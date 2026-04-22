import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

export const calendarTools = [
  {
    name: 'calendar_list_events',
    description: 'List upcoming events from Google Calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 7)' },
        max_results: { type: 'number', description: 'Max events to return (default 10)' },
      },
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a new event in Google Calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_datetime: { type: 'string', description: 'ISO 8601 datetime e.g. 2026-04-25T14:00:00' },
        end_datetime: { type: 'string', description: 'ISO 8601 datetime e.g. 2026-04-25T15:00:00' },
        description: { type: 'string', description: 'Event description or notes' },
        attendee_email: { type: 'string', description: 'Email of attendee to invite' },
        location: { type: 'string', description: 'Location or meeting link' },
      },
      required: ['title', 'start_datetime', 'end_datetime'],
    },
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete a calendar event by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string', description: 'Google Calendar event ID' },
      },
      required: ['event_id'],
    },
  },
]

export async function execCalendarTool(name: string, input: Record<string, unknown>): Promise<string> {
  const auth = await getAuthedClient()
  const calendar = google.calendar({ version: 'v3', auth })

  switch (name) {
    case 'calendar_list_events': {
      const daysAhead = (input.days_ahead as number) || 7
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString()

      const { data } = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        timeMax,
        maxResults: (input.max_results as number) || 10,
        singleEvents: true,
        orderBy: 'startTime',
      })

      if (!data.items?.length) return 'No upcoming events.'

      return data.items.map((e) => {
        const start = e.start?.dateTime || e.start?.date || 'TBD'
        return `📅 ${e.summary}\n   ${new Date(start).toLocaleString()}\n   ${e.location || ''}\n   ID: ${e.id}`
      }).join('\n\n')
    }

    case 'calendar_create_event': {
      const { data: event } = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: input.title as string,
          description: input.description as string,
          location: input.location as string,
          start: { dateTime: input.start_datetime as string, timeZone: 'America/Toronto' },
          end: { dateTime: input.end_datetime as string, timeZone: 'America/Toronto' },
          attendees: input.attendee_email ? [{ email: input.attendee_email as string }] : undefined,
        },
      })
      return `Event created: "${event.summary}" on ${event.start?.dateTime}\nID: ${event.id}`
    }

    case 'calendar_delete_event': {
      await calendar.events.delete({ calendarId: 'primary', eventId: input.event_id as string })
      return `Event deleted.`
    }

    default:
      return `Unknown Calendar tool: ${name}`
  }
}
