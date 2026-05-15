import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
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
  if (!res.ok) throw new Error(`GHL ${res.status}: ${await res.text()}`)
  return res.json()
}

export interface LeadInput {
  type: 'email' | 'calendly'
  from_email: string
  from_name?: string
  subject?: string
  body: string
  source_account: string   // 'info@i-review.ai' or 'siamak.goudarzi@nexterlaw.com'
  event_type?: string      // Calendly event type name
  scheduled_time?: string  // Calendly meeting time
  phone?: string
  company?: string
}

interface LeadAnalysis {
  first_name: string
  last_name: string
  email: string
  phone: string
  company: string
  contact_type: 'prospect' | 'client' | 'partner' | 'skip'
  temperature: 'hot' | 'warm' | 'cold'
  source: string
  pipeline_stage: 'new-lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | null
  summary: string
  tags: string[]
  skip_reason: string | null
}

async function analyzeLeadWithAI(input: LeadInput): Promise<LeadAnalysis> {
  const accountLabel = input.source_account === 'siamak.goudarzi@nexterlaw.com'
    ? 'Outlook (nexterlaw.com)'
    : 'Gmail (i-review.ai)'

  const prompt = `You are a CRM qualification assistant for Dr. Siamak Goudarzi, Founder of Nexter AI Group — an AI implementation agency that builds custom AI systems, automations, websites, CRM pipelines, and virtual assistant platforms for businesses (law firms, clinics, hotels, SMBs). He also runs Nexter Law (legal services).

Analyze this ${input.type === 'calendly' ? 'Calendly booking' : 'incoming email'} and decide whether this person belongs in the CRM.

${input.type === 'calendly' ? `
CALENDLY BOOKING:
Event Type: ${input.event_type || 'Consultation'}
Scheduled Time: ${input.scheduled_time || 'Unknown'}
Invitee Name: ${input.from_name || 'Unknown'}
Invitee Email: ${input.from_email}
` : `
EMAIL:
From: ${input.from_name || ''} <${input.from_email}>
Subject: ${input.subject || '(no subject)'}
Received via: ${accountLabel}
`}
Message:
${input.body}

---

WHO QUALIFIES — set contact_type to prospect/client/partner:
1. Prospect: person asking about AI services, automation, website, CRM, VA platform, legal AI, intake forms, or any service Nexter AI or Nexter Law could provide
2. Client: references an ongoing project, prior engagement, invoice, or existing relationship
3. Partner: asking about partnership, referral, white-label, collaboration, or reseller opportunity
4. Referral: introduced by a mutual contact or mentions someone who referred them
5. Calendly booking: ALWAYS qualifies as a prospect (minimum)

WHO DOES NOT QUALIFY — set contact_type to skip:
- Newsletter or marketing email sent to a list
- Automated system notification (Zoom, Stripe, DocuSign, Google, Microsoft, GitHub, Vercel, etc.)
- Cold sales pitch trying to sell US a product or service
- Spam, phishing, or suspicious email
- Recruiter sending a generic job offer
- Out-of-office or auto-reply
- Social notification (LinkedIn connection request with no message, Twitter, etc.)
- Internal team message or email from Siamak himself
- Vendor or supplier sending an invoice or receipt to us (we are the customer)
- General admin / governmental / regulatory email with no sales context

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "first_name": "string",
  "last_name": "string",
  "email": "${input.from_email}",
  "phone": "string or empty string",
  "company": "string or empty string",
  "contact_type": "prospect|client|partner|skip",
  "temperature": "hot|warm|cold",
  "source": "Calendly Booking|Gmail Inquiry|Outlook Inquiry|Website Referral|Referral|LinkedIn|Other",
  "pipeline_stage": "new-lead|qualified|proposal|negotiation|won|null",
  "summary": "2-3 sentences: who this person is, what they need, and why they qualify (or why skipped)",
  "tags": ["array", "of", "tags"],
  "skip_reason": "one short reason if skip, else null"
}

TEMPERATURE:
- hot: booked a meeting (Calendly), says ready to start, mentions urgency or ASAP, or active client with pressing issue
- warm: specific project in mind, requested a quote/proposal, asking detailed questions about services
- cold: vague inquiry, just exploring, no clear project or budget signals

SOURCE (pick the most specific):
- Calendly Booking: always for Calendly
- Outlook Inquiry: email received at siamak.goudarzi@nexterlaw.com
- Gmail Inquiry: email received at info@i-review.ai or similar
- Website Referral: mentions finding us online, "your website", "i-review.ai", or "nexterai.agency"
- Referral: mentions a specific person who sent them
- LinkedIn: mentions LinkedIn or that they connected/messaged there
- Other: none of the above fit

PIPELINE STAGE (for qualified/prospect/client contacts only, null for skip):
- new-lead: first contact, no specific project yet, just inquiring
- qualified: clear specific need, aware of budget range, real project described
- proposal: explicitly asking for a quote, proposal, pricing, or next steps
- negotiation: actively discussing pricing, scope, or timelines
- won: confirmed client, signed, or actively paying
- null: contact_type is skip

TAGS — include all that apply:
Temperature: "hot", "warm", or "cold"
Source: "calendly-booking", "gmail-inquiry", "outlook-inquiry", "referral", "linkedin"
Account: "${input.source_account === 'siamak.goudarzi@nexterlaw.com' ? 'nexterlaw' : 'i-review'}"
Contact type: "prospect", "client", or "partner"
Industry (if mentioned): "law-firm", "medical", "clinic", "hotel", "hospitality", "real-estate", "finance", "education", "tech", "retail", "dental", "pharmacy"
Service interest (if clear): "ai-va", "website", "crm-setup", "automation", "legal-ai", "intake-form", "content-ai", "chatbot", "nexter-law"`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const text = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  return JSON.parse(text) as LeadAnalysis
}

async function upsertGHLContact(analysis: LeadAnalysis, input: LeadInput): Promise<string> {
  const locationId = process.env.GHL_LOCATION_ID!

  // Search for existing contact by email
  const searchRes = await ghlFetch(
    `/contacts/?locationId=${locationId}&query=${encodeURIComponent(analysis.email)}&limit=5`
  )
  const existing = (searchRes.contacts || []).find(
    (c: { email: string }) => c.email?.toLowerCase() === analysis.email.toLowerCase()
  )

  let contactId: string

  if (existing) {
    // Update existing contact — merge tags, don't overwrite fields that already have data
    const currentTags: string[] = existing.tags || []
    const mergedTags = Array.from(new Set([...currentTags, ...analysis.tags]))

    await ghlFetch(`/contacts/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        firstName: analysis.first_name || existing.firstName,
        lastName:  analysis.last_name  || existing.lastName,
        phone:     analysis.phone      || existing.phone,
        companyName: analysis.company  || existing.companyName,
        tags: mergedTags,
      }),
    })
    contactId = existing.id
  } else {
    // Create new contact
    const createRes = await ghlFetch('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        locationId,
        firstName:   analysis.first_name,
        lastName:    analysis.last_name,
        email:       analysis.email,
        phone:       analysis.phone   || undefined,
        companyName: analysis.company || undefined,
        source:      analysis.source,
        tags:        analysis.tags,
      }),
    })
    contactId = createRes.contact?.id
  }

  // Add a note with full context
  const noteLines = [
    `📥 ${input.type === 'calendly' ? 'Calendly Booking' : `Email via ${input.source_account}`}`,
    input.type === 'email'
      ? `Subject: ${input.subject || 'N/A'}`
      : `Event: ${input.event_type || 'Meeting'}`,
    input.scheduled_time ? `Scheduled: ${input.scheduled_time}` : '',
    '',
    `🎯 Type: ${analysis.contact_type.toUpperCase()}`,
    `🌡️ Temperature: ${analysis.temperature.toUpperCase()}`,
    `📌 Source: ${analysis.source}`,
    analysis.pipeline_stage ? `📊 Stage: ${analysis.pipeline_stage}` : '',
    '',
    `📝 Summary:`,
    analysis.summary,
  ].filter(Boolean).join('\n')

  await ghlFetch(`/contacts/${contactId}/notes/`, {
    method: 'POST',
    body: JSON.stringify({ body: noteLines }),
  })

  // Create pipeline opportunity if pipeline is configured and stage is set
  // Set GHL_PIPELINE_ID in Vercel env vars, plus optional stage IDs:
  //   GHL_STAGE_NEW_LEAD, GHL_STAGE_QUALIFIED, GHL_STAGE_PROPOSAL, GHL_STAGE_NEGOTIATION, GHL_STAGE_WON
  if (!existing && analysis.pipeline_stage && process.env.GHL_PIPELINE_ID) {
    const stageEnvKey = `GHL_STAGE_${analysis.pipeline_stage.toUpperCase().replace(/-/g, '_')}`
    const stageId = process.env[stageEnvKey]
    if (stageId) {
      try {
        await ghlFetch('/opportunities/', {
          method: 'POST',
          body: JSON.stringify({
            pipelineId:      process.env.GHL_PIPELINE_ID,
            locationId,
            contactId,
            name:            `${analysis.first_name} ${analysis.last_name} — ${analysis.source}`,
            pipelineStageId: stageId,
            status:          'open',
          }),
        })
      } catch { /* pipeline update is non-critical — GHL returns 400 if opportunity already exists */ }
    }
  }

  const action = existing ? 'Updated' : 'Created'
  return `${action} GHL contact: ${analysis.first_name} ${analysis.last_name} (${analysis.email}) — ${analysis.contact_type.toUpperCase()} | ${analysis.temperature.toUpperCase()} | Stage: ${analysis.pipeline_stage || 'N/A'}`
}

export async function processLead(input: LeadInput): Promise<{ success: boolean; message: string }> {
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) {
    return { success: true, message: 'CRM not configured — skipped' }
  }

  try {
    const analysis = await analyzeLeadWithAI(input)

    if (analysis.contact_type === 'skip') {
      return { success: true, message: `Skipped (${analysis.skip_reason || 'not a lead'}): ${input.from_email}` }
    }

    const result = await upsertGHLContact(analysis, input)
    return { success: true, message: result }
  } catch (err) {
    return { success: false, message: `Error processing ${input.from_email}: ${String(err)}` }
  }
}
