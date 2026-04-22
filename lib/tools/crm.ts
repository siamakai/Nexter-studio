import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase not configured')
  return createClient(url, key)
}

export const crmTools = [
  {
    name: 'crm_create_lead',
    description: 'Save a new lead to the CRM database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Full name' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number' },
        company: { type: 'string', description: 'Company name' },
        classification: { type: 'string', enum: ['hot', 'warm', 'cold'] },
        notes: { type: 'string', description: 'Summary of their need' },
        source: { type: 'string', enum: ['gmail', 'wordpress', 'linkedin', 'manual'] },
      },
      required: ['name', 'classification', 'notes'],
    },
  },
  {
    name: 'crm_search_leads',
    description: 'Search leads in the CRM by name, status, or classification.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        status: { type: 'string' },
        classification: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'crm_update_status',
    description: 'Update a lead status and log what happened.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lead_id: { type: 'string' },
        new_status: { type: 'string', enum: ['new', 'contacted', 'meeting', 'proposal', 'active', 'closed', 'lost'] },
        note: { type: 'string' },
      },
      required: ['lead_id', 'new_status', 'note'],
    },
  },
  {
    name: 'crm_draft_email',
    description: 'Generate and save a follow-up email draft for a lead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lead_id: { type: 'string' },
        context: { type: 'string' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'crm_pipeline_summary',
    description: 'Get a live count of all leads by status and classification.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'crm_log_note',
    description: 'Add a note or interaction log to a lead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lead_id: { type: 'string' },
        note: { type: 'string' },
        type: { type: 'string', enum: ['note', 'call', 'email_in', 'email_out'] },
      },
      required: ['lead_id', 'note'],
    },
  },
]

export async function execCrmTool(name: string, input: Record<string, unknown>): Promise<string> {
  const supabase = getSupabase()

  switch (name) {
    case 'crm_create_lead': {
      const { data: lead, error } = await supabase
        .from('leads')
        .insert({ ...input, status: 'new' })
        .select()
        .single()
      if (error) return `Error: ${error.message}`
      await supabase.from('interactions').insert({
        lead_id: lead.id, type: 'note',
        subject: 'Lead created via AI chat',
        body: input.notes as string,
        agent: 'studio',
      })
      return JSON.stringify({ success: true, lead_id: lead.id, name: lead.name, message: `Lead "${lead.name}" created successfully` })
    }

    case 'crm_search_leads': {
      let query = supabase.from('leads').select('id, name, company, email, status, classification, notes, created_at')
      if (input.name) query = query.ilike('name', `%${input.name}%`)
      if (input.status) query = query.eq('status', input.status as string)
      if (input.classification) query = query.eq('classification', input.classification as string)
      query = query.order('created_at', { ascending: false }).limit((input.limit as number) || 10)
      const { data, error } = await query
      if (error) return `Error: ${error.message}`
      return JSON.stringify(data || [])
    }

    case 'crm_update_status': {
      const { error } = await supabase
        .from('leads')
        .update({ status: input.new_status })
        .eq('id', input.lead_id as string)
      if (error) return `Error: ${error.message}`
      await supabase.from('interactions').insert({
        lead_id: input.lead_id, type: 'status_change',
        subject: `Status → ${input.new_status}`,
        body: input.note as string,
        agent: 'studio',
      })
      return JSON.stringify({ success: true, new_status: input.new_status })
    }

    case 'crm_draft_email': {
      const { data: lead } = await supabase.from('leads').select('*').eq('id', input.lead_id).single()
      if (!lead) return 'Lead not found'
      const subject = `Following up — ${lead.company || lead.name}`
      const body = `Hi ${lead.name.split(' ')[0]},\n\nI wanted to follow up on our conversation about ${lead.notes || 'AI automation'}.\n\nWould you have 20 minutes this week for a quick call?\n\nBest,\nSiamak Goudarzi\nFounder – Nexter AI Group`
      const { data: draft, error } = await supabase.from('email_drafts').insert({ lead_id: input.lead_id, subject, body, status: 'draft' }).select().single()
      if (error) return `Error: ${error.message}`
      return JSON.stringify({ success: true, subject, body, draft_id: draft.id })
    }

    case 'crm_pipeline_summary': {
      const { data: leads } = await supabase.from('leads').select('status, classification')
      if (!leads) return '{}'
      return JSON.stringify({
        total: leads.length,
        by_status: leads.reduce((acc: Record<string, number>, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc }, {}),
        by_classification: leads.reduce((acc: Record<string, number>, l) => { acc[l.classification] = (acc[l.classification] || 0) + 1; return acc }, {}),
      })
    }

    case 'crm_log_note': {
      const { error } = await supabase.from('interactions').insert({
        lead_id: input.lead_id, type: input.type || 'note', body: input.note as string, agent: 'studio',
      })
      if (error) return `Error: ${error.message}`
      return JSON.stringify({ success: true })
    }

    default:
      return `Unknown CRM tool: ${name}`
  }
}
