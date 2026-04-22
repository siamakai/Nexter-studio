import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

export const gmailTools = [
  {
    name: 'gmail_read_inbox',
    description: 'Read recent emails from Gmail inbox. Use to find new leads or client messages.',
    input_schema: {
      type: 'object' as const,
      properties: {
        max_results: { type: 'number', description: 'Number of emails to fetch (default 10)' },
        query: { type: 'string', description: 'Gmail search query e.g. "is:unread" or "from:client@example.com"' },
      },
    },
  },
  {
    name: 'gmail_send_email',
    description: 'Send an email from the connected Gmail account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_get_email',
    description: 'Get the full content of a specific email by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID' },
      },
      required: ['message_id'],
    },
  },
]

export async function execGmailTool(name: string, input: Record<string, unknown>): Promise<string> {
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  switch (name) {
    case 'gmail_read_inbox': {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        maxResults: (input.max_results as number) || 10,
        q: (input.query as string) || 'is:unread',
      })

      if (!data.messages?.length) return 'No emails found.'

      const emails = await Promise.all(
        data.messages.slice(0, 5).map(async (msg) => {
          const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })
          const headers = full.payload?.headers || []
          const get = (name: string) => headers.find((h) => h.name === name)?.value || ''
          return `ID: ${msg.id}\nFrom: ${get('From')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}`
        })
      )
      return emails.join('\n\n---\n\n')
    }

    case 'gmail_send_email': {
      const message = [
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        input.body as string,
      ].join('\n')

      const encoded = Buffer.from(message).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } })
      return `Email sent to ${input.to}`
    }

    case 'gmail_get_email': {
      const { data } = await gmail.users.messages.get({ userId: 'me', id: input.message_id as string, format: 'full' })
      const headers = data.payload?.headers || []
      const get = (name: string) => headers.find((h) => h.name === name)?.value || ''
      const body = data.payload?.parts?.[0]?.body?.data
        ? Buffer.from(data.payload.parts[0].body.data, 'base64').toString()
        : data.payload?.body?.data
        ? Buffer.from(data.payload.body.data, 'base64').toString()
        : '(no body)'
      return `From: ${get('From')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}\n\n${body.slice(0, 2000)}`
    }

    default:
      return `Unknown Gmail tool: ${name}`
  }
}
