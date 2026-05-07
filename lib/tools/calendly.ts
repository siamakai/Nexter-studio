const CALENDLY_BASE = 'https://api.calendly.com'
const TZ = 'Europe/Budapest'
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

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

// Fetch ALL pages of events for a given scope+status, respecting rate limits
async function fetchEventsByStatus(scopeParam: string, minTime: string, status: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let pageToken = ''

  while (true) {
    await delay(400)
    const tokenParam = pageToken ? `&page_token=${pageToken}` : ''
    const data = await calendlyGet(
      `/scheduled_events?${scopeParam}&count=100&status=${status}&min_start_time=${minTime}&sort=start_time:desc${tokenParam}`
    )
    all.push(...(data.collection || []))
    pageToken = data.pagination?.next_page_token || ''
    if (!pageToken) break
  }
  return all
}

// Fetch both active and canceled events to capture all contacts
// Uses organization scope to capture events across the whole account
async function fetchAllEvents(orgUri: string, minTime: string): Promise<Record<string, unknown>[]> {
  const scope = `organization=${encodeURIComponent(orgUri)}`
  const [active, canceled] = await Promise.all([
    fetchEventsByStatus(scope, minTime, 'active'),
    fetchEventsByStatus(scope, minTime, 'canceled'),
  ])
  return [...active, ...canceled]
}

async function ghlUpsertContact(email: string, firstName: string, lastName: string, note: string) {
  const locationId = process.env.GHL_LOCATION_ID
  const headers = {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  }
  const searchRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=1`,
    { headers }
  )
  const searchData = await searchRes.json()
  const existing = (searchData.contacts || [])[0]

  if (existing) {
    await fetch(`https://services.leadconnectorhq.com/contacts/${existing.id}/notes/`, {
      method: 'POST', headers,
      body: JSON.stringify({ body: note }),
    })
    return { id: existing.id, action: 'updated' }
  }

  const createRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST', headers,
    body: JSON.stringify({ locationId, email, firstName, lastName, source: 'Calendly', tags: ['calendly'] }),
  })
  const createData = await createRes.json()
  return { id: createData.contact?.id, action: 'created' }
}

export const calendlyTools = [
  {
    name: 'calendly_list_events',
    description: 'List Calendly meetings — upcoming by default. Set past=true to list past meetings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Number of events to return (default 20)' },
        status: { type: 'string', description: 'active or canceled (default: active)' },
        past: { type: 'boolean', description: 'Set true to list past/completed meetings instead of upcoming' },
      },
    },
  },
  {
    name: 'calendly_get_invitee',
    description: 'Get details for ONE specific Calendly event by UUID. Do NOT call this in a loop for many events — use calendly_list_contacts instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_uuid: { type: 'string', description: 'Calendly event UUID' },
      },
      required: ['event_uuid'],
    },
  },
  {
    name: 'calendly_list_contacts',
    description: 'List ALL people who have ever booked a Calendly meeting — name, email, meeting date. Use this when asked to show Calendly contacts or all people who booked. Handles pagination and rate limits automatically. Do NOT call calendly_get_invitee in a loop — use this tool instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        months_back: { type: 'number', description: 'How many months of history to scan (default 36 = 3 years)' },
      },
    },
  },
  {
    name: 'calendly_sync_to_crm',
    description: 'Fetch ALL Calendly invitees and add or update them as contacts in Go High Level CRM. Use when asked to sync Calendly contacts to CRM.',
    input_schema: {
      type: 'object' as const,
      properties: {
        months_back: { type: 'number', description: 'How many months of history to scan (default 36 = 3 years)' },
      },
    },
  },
]

export async function execCalendlyTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (!process.env.CALENDLY_API_KEY) {
    return 'Calendly not connected. Add CALENDLY_API_KEY to environment variables.'
  }

  switch (name) {
    case 'calendly_list_events': {
      const me = await calendlyGet('/users/me')
      const userUri = me.resource.uri
      const count = (input.count as number) || 20
      const status = (input.status as string) || 'active'
      const past = input.past as boolean

      let url: string
      if (past) {
        const maxTime = new Date().toISOString()
        const minTime = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
        url = `/scheduled_events?user=${encodeURIComponent(userUri)}&count=${count}&status=${status}&min_start_time=${minTime}&max_start_time=${maxTime}&sort=start_time:desc`
      } else {
        const now = new Date().toISOString()
        url = `/scheduled_events?user=${encodeURIComponent(userUri)}&count=${count}&status=${status}&min_start_time=${now}&sort=start_time:asc`
      }

      const data = await calendlyGet(url)
      if (!data.collection?.length) return past ? 'No past Calendly events found.' : 'No upcoming Calendly events.'

      return `${past ? '📋 Past' : '📅 Upcoming'} Calendly Events (${data.collection.length}):\n\n` +
        data.collection.map((e: Record<string, unknown>) => {
          const evName = (e.name as string) || 'Meeting'
          const start = e.start_time as string
          const uuid = (e.uri as string).split('/').pop()
          return `• ${fmtTime(start)} — ${evName} | UUID: ${uuid}`
        }).join('\n')
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

    case 'calendly_list_contacts': {
      const me = await calendlyGet('/users/me')
      const orgUri = me.resource.current_organization
      const months = (input.months_back as number) || 36
      const minTime = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString()
      const now = new Date()

      const events = await fetchAllEvents(orgUri, minTime)
      if (!events.length) return 'No Calendly events found.'

      const seen = new Set<string>()
      const contacts: Array<{ name: string; email: string; rawDate: Date; label: string }> = []

      for (const event of events) {
        const uuid = (event.uri as string).split('/').pop()!
        const eventStart = new Date(event.start_time as string)
        const isPast = eventStart < now
        try {
          await delay(350)
          const invData = await calendlyGet(`/scheduled_events/${uuid}/invitees`)
          for (const inv of (invData.collection || [])) {
            if (!inv.email || seen.has(inv.email)) continue
            seen.add(inv.email)
            contacts.push({
              name: inv.name || 'Unknown',
              email: inv.email,
              rawDate: eventStart,
              label: `${isPast ? '[PAST]' : '[UPCOMING]'} ${fmtTime(event.start_time as string)}`,
            })
          }
        } catch { /* skip */ }
      }

      if (!contacts.length) return 'No contacts found in Calendly.'

      // Sort: upcoming first (soonest), then past (most recent)
      contacts.sort((a, b) => {
        const aUp = a.rawDate >= now, bUp = b.rawDate >= now
        if (aUp && !bUp) return -1
        if (!aUp && bUp) return 1
        if (aUp && bUp) return a.rawDate.getTime() - b.rawDate.getTime()
        return b.rawDate.getTime() - a.rawDate.getTime()
      })

      const lines = contacts.map((c, i) => `${i + 1}. ${c.name} | ${c.email} | ${c.label}`)

      return [
        `👥 CALENDLY CONTACTS — ${contacts.length} unique people`,
        `Events scanned: ${events.length} | Lookback: ${months} months`,
        `Today: ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
        `--- SHOW THIS LIST EXACTLY AS-IS — DO NOT REFORMAT OR REGROUP ---`,
        '',
        ...lines,
      ].join('\n')
    }

    case 'calendly_sync_to_crm': {
      if (!process.env.GHL_API_KEY) return 'GHL CRM not connected — cannot sync contacts.'

      const me = await calendlyGet('/users/me')
      const orgUri = me.resource.current_organization
      const months = (input.months_back as number) || 36
      const minTime = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString()

      const events = await fetchAllEvents(orgUri, minTime)
      if (!events.length) return 'No Calendly events found to sync.'

      const seen = new Set<string>()
      let created = 0, updated = 0, failed = 0
      const results: string[] = []

      for (const event of events) {
        const uuid = (event.uri as string).split('/').pop()!
        try {
          await delay(350)
          const invData = await calendlyGet(`/scheduled_events/${uuid}/invitees`)
          for (const inv of (invData.collection || [])) {
            if (!inv.email || seen.has(inv.email)) continue
            seen.add(inv.email)
            const nameParts = (inv.name || '').split(' ')
            const note = `Calendly: ${event.name} on ${fmtTime(event.start_time as string)}`
            try {
              const r = await ghlUpsertContact(inv.email, nameParts[0] || '', nameParts.slice(1).join(' ') || '', note)
              if (r.action === 'created') { created++; results.push(`✅ Added: ${inv.name} <${inv.email}>`) }
              else { updated++; results.push(`🔄 Updated: ${inv.name} <${inv.email}>`) }
            } catch { failed++; results.push(`❌ Failed: ${inv.email}`) }
          }
        } catch { /* skip */ }
      }

      return [
        `📋 Calendly → CRM Sync Complete`,
        `Events scanned: ${events.length} | Unique contacts: ${seen.size}`,
        `Created: ${created} | Updated: ${updated}${failed > 0 ? ` | Failed: ${failed}` : ''}`,
        '',
        results.join('\n'),
      ].filter(Boolean).join('\n')
    }

    default:
      return `Unknown Calendly tool: ${name}`
  }
}
