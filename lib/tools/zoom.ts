async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID!
  const clientId = process.env.ZOOM_CLIENT_ID!
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) throw new Error(`Zoom auth failed: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

async function zoomPost(path: string, body: unknown) {
  const token = await getZoomAccessToken()
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Zoom API error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function zoomGet(path: string) {
  const token = await getZoomAccessToken()
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Zoom API error ${res.status}: ${await res.text()}`)
  return res.json()
}

export const zoomTools = [
  {
    name: 'zoom_create_meeting',
    description: 'Create a Zoom meeting and get the join link. Use this when you need to generate a video call link for a meeting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', description: 'Meeting topic/title' },
        start_datetime: { type: 'string', description: 'ISO 8601 datetime e.g. 2026-04-25T14:00:00' },
        duration_minutes: { type: 'number', description: 'Meeting duration in minutes (default 60)' },
        agenda: { type: 'string', description: 'Meeting agenda or description' },
      },
      required: ['topic', 'start_datetime'],
    },
  },
  {
    name: 'zoom_list_recordings',
    description: 'List recent Zoom cloud recordings with their summaries (last 30 days).',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'How many days back to look (default 30)' },
      },
    },
  },
  {
    name: 'zoom_get_meeting_summary',
    description: 'Get the saved summary for a past meeting from the local meetings folder.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search term — meeting topic, contact name, or date (e.g. "John Smith" or "2026-04")' },
      },
      required: ['search'],
    },
  },
]

export async function execZoomTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (!process.env.ZOOM_ACCOUNT_ID || !process.env.ZOOM_CLIENT_ID || !process.env.ZOOM_CLIENT_SECRET) {
    return 'Zoom not connected. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET to environment variables.'
  }

  switch (name) {
    case 'zoom_create_meeting': {
      const meeting = await zoomPost('/users/me/meetings', {
        topic: input.topic,
        type: 2, // Scheduled meeting
        start_time: input.start_datetime,
        duration: input.duration_minutes || 60,
        agenda: input.agenda || '',
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: true,
          waiting_room: false,
          auto_recording: 'cloud',
        },
      })

      return [
        `Zoom meeting created: "${meeting.topic}"`,
        `Start: ${new Date(meeting.start_time).toLocaleString()}`,
        `Duration: ${meeting.duration} min`,
        `Join URL: ${meeting.join_url}`,
        `Meeting ID: ${meeting.id}`,
        `Password: ${meeting.password || 'none'}`,
      ].join('\n')
    }

    case 'zoom_list_recordings': {
      const days = (input.days as number) || 30
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const to = new Date().toISOString().slice(0, 10)
      const data = await zoomGet(`/users/me/recordings?from=${from}&to=${to}&page_size=20`)
      const meetings = data.meetings || []
      if (!meetings.length) return `No recordings found in the last ${days} days.`
      return meetings.map((m: Record<string, unknown>) => {
        const start = new Date(m.start_time as string).toLocaleString('en-GB', { timeZone: 'Europe/Budapest', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
        const hasTranscript = ((m.recording_files as Record<string, unknown>[]) || []).some(f => (f.file_type as string) === 'TRANSCRIPT')
        return `📹 ${m.topic} | ${start} | ${m.duration}min${hasTranscript ? ' | ✓ transcript' : ''} | ID: ${m.uuid}`
      }).join('\n')
    }

    case 'zoom_get_meeting_summary': {
      const fs = await import('fs/promises')
      const path = await import('path')
      const dir = path.join(process.cwd(), 'meetings')
      try {
        const files = await fs.readdir(dir)
        const search = (input.search as string).toLowerCase()
        const matches = files.filter(f => f.toLowerCase().includes(search))
        if (!matches.length) return `No meeting summaries found matching "${input.search}". Summaries are saved after each Zoom call.`
        // Return the most recent match
        const latest = matches.sort().reverse()[0]
        const content = await fs.readFile(path.join(dir, latest), 'utf-8')
        return `[${latest}]\n\n${content}`
      } catch {
        return `No meetings folder found yet. Summaries are saved automatically after Zoom calls end.`
      }
    }

    default:
      return `Unknown Zoom tool: ${name}`
  }
}
