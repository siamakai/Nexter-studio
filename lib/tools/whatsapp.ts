import Anthropic from '@anthropic-ai/sdk'

const BASE = 'https://graph.facebook.com/v19.0'
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN!
const WABA_ID  = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!

// In-memory store for incoming messages (production: use Supabase)
const inboxCache: WhatsAppMessage[] = []

export interface WhatsAppMessage {
  id:        string
  from:      string
  name:      string
  body:      string
  timestamp: string
  type:      string
}

export function storeIncomingMessage(msg: WhatsAppMessage) {
  inboxCache.unshift(msg)
  if (inboxCache.length > 200) inboxCache.pop()
}

async function waFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(json))
  return json
}

async function readInbox(maxResults = 20): Promise<string> {
  if (!TOKEN || !PHONE_ID) return 'WhatsApp not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to environment variables.'
  if (inboxCache.length === 0) return 'No WhatsApp messages received yet. Messages appear here once someone contacts you.'
  const msgs = inboxCache.slice(0, maxResults)
  const lines = msgs.map((m, i) =>
    `${i + 1}. From: ${m.name} (${m.from})\n   "${m.body}"\n   ${new Date(parseInt(m.timestamp) * 1000).toLocaleString('en-GB', { timeZone: 'Europe/Budapest' })}`
  )
  return `WhatsApp Inbox (${msgs.length} messages):\n\n${lines.join('\n\n')}`
}

async function sendMessage(to: string, body: string): Promise<string> {
  if (!TOKEN || !PHONE_ID) return 'WhatsApp not configured.'
  // Strip non-digits, ensure international format
  const phone = to.replace(/\D/g, '')
  await waFetch(`/${PHONE_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } }),
  })
  return `✅ WhatsApp message sent to ${to}.`
}

async function getContacts(): Promise<string> {
  if (!TOKEN || !WABA_ID) return 'WhatsApp Business Account ID not configured.'
  // Unique senders from inbox cache
  const seen = new Map<string, WhatsAppMessage>()
  for (const m of inboxCache) {
    if (!seen.has(m.from)) seen.set(m.from, m)
  }
  if (seen.size === 0) return 'No WhatsApp contacts yet.'
  const lines = Array.from(seen.values()).map((m, i) =>
    `${i + 1}. ${m.name} · +${m.from}`
  )
  return `WhatsApp Contacts (${seen.size}):\n\n${lines.join('\n')}`
}

async function sendTemplate(to: string, templateName: string, langCode = 'en_US'): Promise<string> {
  if (!TOKEN || !PHONE_ID) return 'WhatsApp not configured.'
  const phone = to.replace(/\D/g, '')
  await waFetch(`/${PHONE_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: { name: templateName, language: { code: langCode } },
    }),
  })
  return `✅ WhatsApp template "${templateName}" sent to ${to}.`
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
export const whatsappTools: Anthropic.Tool[] = [
  {
    name: 'whatsapp_read_inbox',
    description: 'Read incoming WhatsApp messages. Shows who contacted you and what they said.',
    input_schema: {
      type: 'object' as const,
      properties: { max_results: { type: 'number', description: 'Max messages to return (default 20)' } },
      required: [],
    },
  },
  {
    name: 'whatsapp_send_message',
    description: 'Send a WhatsApp message to a phone number.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:   { type: 'string', description: 'Phone number in international format e.g. 36201234567' },
        body: { type: 'string', description: 'Message text to send' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'whatsapp_get_contacts',
    description: 'List all unique contacts who have sent you a WhatsApp message.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'whatsapp_send_template',
    description: 'Send a pre-approved WhatsApp Business template message (required for first contact after 24h).',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:            { type: 'string', description: 'Phone number in international format' },
        template_name: { type: 'string', description: 'Name of the approved template' },
        lang_code:     { type: 'string', description: 'Language code e.g. en_US, hu_HU (default: en_US)' },
      },
      required: ['to', 'template_name'],
    },
  },
]

export async function execWhatsAppTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'whatsapp_read_inbox':    return await readInbox((input.max_results as number) || 20)
      case 'whatsapp_send_message':  return await sendMessage(input.to as string, input.body as string)
      case 'whatsapp_get_contacts':  return await getContacts()
      case 'whatsapp_send_template': return await sendTemplate(input.to as string, input.template_name as string, (input.lang_code as string) || 'en_US')
      default:                       return `Unknown WhatsApp tool: ${name}`
    }
  } catch (e) {
    return `WhatsApp error: ${String(e)}`
  }
}
