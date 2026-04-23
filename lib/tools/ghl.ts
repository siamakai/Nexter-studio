const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

async function ghlFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Version: GHL_VERSION,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`GHL API error ${res.status}: ${await res.text()}`)
  return res.json()
}

function locationId() {
  const id = process.env.GHL_LOCATION_ID
  if (!id) throw new Error('GHL_LOCATION_ID env var not set.')
  return id
}

export const ghlTools = [
  {
    name: 'ghl_create_contact',
    description: 'Create a new contact/lead in Go High Level CRM.',
    input_schema: {
      type: 'object' as const,
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company_name: { type: 'string' },
        source: { type: 'string', description: 'Lead source e.g. Website, Referral' },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string', description: 'Initial note about this contact' },
      },
      required: ['email'],
    },
  },
  {
    name: 'ghl_search_contacts',
    description: 'Search for contacts in Go High Level CRM by name, email, or phone.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — name, email, or phone' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ghl_get_contact',
    description: 'Get full details for a specific GHL contact by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string' },
      },
      required: ['contact_id'],
    },
  },
  {
    name: 'ghl_update_contact',
    description: 'Update a GHL contact — change tags, name, company, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company_name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['contact_id'],
    },
  },
  {
    name: 'ghl_add_note',
    description: 'Add a note to a GHL contact — log a call, meeting, or interaction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string' },
        body: { type: 'string', description: 'Note content' },
      },
      required: ['contact_id', 'body'],
    },
  },
  {
    name: 'ghl_get_pipelines',
    description: 'List all sales pipelines and their stages in Go High Level.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'ghl_list_opportunities',
    description: 'List deals/opportunities in a GHL pipeline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pipeline_id: { type: 'string' },
        status: { type: 'string', description: 'open, won, lost, or abandoned (default: open)' },
      },
    },
  },
  {
    name: 'ghl_create_opportunity',
    description: 'Create a sales opportunity/deal in a GHL pipeline for a contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string' },
        pipeline_id: { type: 'string' },
        stage_id: { type: 'string' },
        title: { type: 'string' },
        monetary_value: { type: 'number' },
        status: { type: 'string', description: 'open, won, lost, or abandoned' },
      },
      required: ['contact_id', 'pipeline_id', 'stage_id', 'title'],
    },
  },
]

export async function execGhlTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (!process.env.GHL_API_KEY) {
    return 'Go High Level not connected. Add GHL_API_KEY to environment variables.'
  }

  switch (name) {
    case 'ghl_create_contact': {
      const body: Record<string, unknown> = {
        locationId: locationId(),
        email: input.email,
        firstName: input.first_name,
        lastName: input.last_name,
        phone: input.phone,
        companyName: input.company_name,
        source: input.source,
        tags: input.tags,
      }
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k])

      const data = await ghlFetch('/contacts/', { method: 'POST', body: JSON.stringify(body) })
      const contact = data.contact

      if (input.notes && contact?.id) {
        await ghlFetch(`/contacts/${contact.id}/notes/`, {
          method: 'POST',
          body: JSON.stringify({ body: input.notes, userId: contact.id }),
        })
      }

      return `Contact created in GHL:\nName: ${contact?.firstName || ''} ${contact?.lastName || ''}\nEmail: ${contact?.email}\nID: ${contact?.id}`
    }

    case 'ghl_search_contacts': {
      const data = await ghlFetch(
        `/contacts/?locationId=${locationId()}&query=${encodeURIComponent(input.query as string)}&limit=${input.limit || 10}`
      )
      const contacts = data.contacts || []
      if (!contacts.length) return 'No contacts found.'
      return contacts.map((c: Record<string, string>) =>
        `👤 ${c.firstName || ''} ${c.lastName || ''} | ${c.email || ''} | ${c.phone || ''} | ID: ${c.id}`
      ).join('\n')
    }

    case 'ghl_get_contact': {
      const data = await ghlFetch(`/contacts/${input.contact_id}`)
      const c = data.contact
      return [
        `Name: ${c.firstName || ''} ${c.lastName || ''}`,
        `Email: ${c.email || ''}`,
        `Phone: ${c.phone || ''}`,
        `Company: ${c.companyName || ''}`,
        `Tags: ${(c.tags || []).join(', ') || 'none'}`,
        `ID: ${c.id}`,
      ].join('\n')
    }

    case 'ghl_update_contact': {
      const { contact_id, ...rest } = input
      const body: Record<string, unknown> = {
        firstName: rest.first_name,
        lastName: rest.last_name,
        email: rest.email,
        phone: rest.phone,
        companyName: rest.company_name,
        tags: rest.tags,
      }
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k])
      await ghlFetch(`/contacts/${contact_id}`, { method: 'PUT', body: JSON.stringify(body) })
      return `Contact ${contact_id} updated.`
    }

    case 'ghl_add_note': {
      await ghlFetch(`/contacts/${input.contact_id}/notes/`, {
        method: 'POST',
        body: JSON.stringify({ body: input.body }),
      })
      return `Note added to contact ${input.contact_id}.`
    }

    case 'ghl_get_pipelines': {
      const data = await ghlFetch(`/opportunities/pipelines/?locationId=${locationId()}`)
      const pipelines = data.pipelines || []
      if (!pipelines.length) return 'No pipelines found.'
      return pipelines.map((p: Record<string, unknown>) => {
        const stages = ((p.stages as Record<string, string>[]) || [])
          .map((s) => `    - ${s.name} (ID: ${s.id})`).join('\n')
        return `Pipeline: ${p.name} (ID: ${p.id})\n${stages}`
      }).join('\n\n')
    }

    case 'ghl_list_opportunities': {
      const params = new URLSearchParams({ locationId: locationId() })
      if (input.pipeline_id) params.set('pipelineId', input.pipeline_id as string)
      params.set('status', (input.status as string) || 'open')

      const data = await ghlFetch(`/opportunities/search/?${params}`)
      const opps = data.opportunities || []
      if (!opps.length) return 'No opportunities found.'
      return opps.map((o: Record<string, unknown>) =>
        `💼 ${o.name} | Stage: ${(o.pipelineStage as Record<string, string>)?.name || '?'} | $${o.monetaryValue || 0} | ID: ${o.id}`
      ).join('\n')
    }

    case 'ghl_create_opportunity': {
      const body = {
        locationId: locationId(),
        contactId: input.contact_id,
        pipelineId: input.pipeline_id,
        pipelineStageId: input.stage_id,
        name: input.title,
        monetaryValue: input.monetary_value,
        status: input.status || 'open',
      }
      const data = await ghlFetch('/opportunities/', { method: 'POST', body: JSON.stringify(body) })
      const opp = data.opportunity
      return `Opportunity created:\nTitle: ${opp?.name}\nValue: $${opp?.monetaryValue || 0}\nID: ${opp?.id}`
    }

    default:
      return `Unknown GHL tool: ${name}`
  }
}
