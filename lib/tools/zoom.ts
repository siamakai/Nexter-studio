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
          auto_recording: 'none',
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

    default:
      return `Unknown Zoom tool: ${name}`
  }
}
