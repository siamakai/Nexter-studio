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
  temperature: 'hot' | 'warm' | 'cold'
  source: string
  summary: string
  tags: string[]
  should_create: boolean   // false if it's spam/newsletter/auto-reply
}

async function analyzeLeadWithAI(input: LeadInput): Promise<LeadAnalysis> {
  const prompt = `You are a CRM automation assistant for Nexter AI Agency (an AI implementation agency).

Analyze the following ${input.type === 'calendly' ? 'Calendly booking' : 'incoming email'} and extract lead information.

${input.type === 'calendly' ? `
CALENDLY BOOKING:
Event Type: ${input.event_type || 'Consultation'}
Scheduled Time: ${input.scheduled_time || 'Unknown'}
Invitee Name: ${input.from_name || 'Unknown'}
Invitee Email: ${input.from_email}
` : `
EMAIL:
From: ${input.from_name || ''} <${input.from_email}>
Subject: ${input.subject || ''}
Received at: ${input.source_account}
`}

Message/Notes:
${input.body}

---

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "first_name": "string",
  "last_name": "string",
  "email": "${input.from_email}",
  "phone": "string or empty",
  "company": "string or empty",
  "temperature": "hot|warm|cold",
  "source": "Calendly Booking|Website Inquiry|Email Inquiry|Referral|LinkedIn|Other",
  "summary": "2-3 sentence summary of who this is and what they need",
  "tags": ["array", "of", "tags"],
  "should_create": true
}

Temperature rules:
- hot: booked a meeting (Calendly), mentions urgency, ready to start, says "ASAP" or "this week"
- warm: asking specific questions, has a real project in mind, requested a quote
- cold: generic inquiry, newsletter, not sure what they want, no clear project

Source rules:
- Calendly Booking: always use this for Calendly events
- Website Inquiry: mentions "your website", "found you online", no specific referrer
- Referral: mentions a person's name who referred them
- LinkedIn: mentions LinkedIn or DM
- Email Inquiry: direct email with a specific question

Tag rules — always include:
- temperature tag: "hot", "warm", or "cold"
- source tag: lowercase version of source e.g. "calendly-booking", "website-inquiry"
- account tag: "${input.source_account === 'siamak.goudarzi@nexterlaw.com' ? 'nexterlaw' : 'i-review'}"
- add relevant industry tags if mentioned (e.g. "law-firm", "medical", "real-estate", "hospitality")

Set should_create to false ONLY if: auto-reply, out-of-office, newsletter, spam, or email from yourself.`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (response.content[0] as { type: string; text: string }).text.trim()
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
    // Update existing contact — merge tags (don't overwrite)
    const currentTags: string[] = existing.tags || []
    const mergedTags = Array.from(new Set([...currentTags, ...analysis.tags]))

    await ghlFetch(`/contacts/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        firstName: analysis.first_name || existing.firstName,
        lastName: analysis.last_name || existing.lastName,
        phone: analysis.phone || existing.phone,
        companyName: analysis.company || existing.companyName,
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
        firstName: analysis.first_name,
        lastName: analysis.last_name,
        email: analysis.email,
        phone: analysis.phone || undefined,
        companyName: analysis.company || undefined,
        source: analysis.source,
        tags: analysis.tags,
      }),
    })
    contactId = createRes.contact?.id
  }

  // Add note
  const noteLines = [
    `📥 Auto-captured via ${input.type === 'calendly' ? 'Calendly Booking' : `Email (${input.source_account})`}`,
    input.type === 'email' ? `Subject: ${input.subject || 'N/A'}` : `Event: ${input.event_type || 'Meeting'}`,
    input.scheduled_time ? `Scheduled: ${input.scheduled_time}` : '',
    '',
    `🌡️ Lead Temperature: ${analysis.temperature.toUpperCase()}`,
    `📌 Source: ${analysis.source}`,
    '',
    `📝 Summary:`,
    analysis.summary,
  ].filter(Boolean).join('\n')

  await ghlFetch(`/contacts/${contactId}/notes/`, {
    method: 'POST',
    body: JSON.stringify({ body: noteLines }),
  })

  return `${existing ? 'Updated' : 'Created'} GHL contact: ${analysis.first_name} ${analysis.last_name} (${analysis.email}) — ${analysis.temperature.toUpperCase()}`
}

export async function processLead(input: LeadInput): Promise<{ success: boolean; message: string }> {
  try {
    const analysis = await analyzeLeadWithAI(input)

    if (!analysis.should_create) {
      return { success: true, message: `Skipped (not a lead): ${input.from_email}` }
    }

    const result = await upsertGHLContact(analysis, input)
    return { success: true, message: result }
  } catch (err) {
    return { success: false, message: `Error processing lead from ${input.from_email}: ${String(err)}` }
  }
}
