import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'

const ACCOUNT_PROP = {
  type: 'string',
  description: 'Which email account to use (e.g. info@i-review.ai). Defaults to primary account if not specified.',
}

export const gmailTools = [
  {
    name: 'gmail_read_inbox',
    description: 'Read recent emails from a Gmail inbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: ACCOUNT_PROP,
        max_results: { type: 'number', description: 'Number of emails to fetch (default 10)' },
        query: { type: 'string', description: 'Gmail search query e.g. "is:unread" or "from:client@example.com"' },
      },
    },
  },
  {
    name: 'gmail_send_email',
    description: 'Send an email from a connected Gmail account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_email: ACCOUNT_PROP,
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
        account_email: ACCOUNT_PROP,
        message_id: { type: 'string', description: 'Gmail message ID' },
      },
      required: ['message_id'],
    },
  },
]

export async function execGmailTool(name: string, input: Record<string, unknown>): Promise<string> {
  const auth = await getAuthedClient(input.account_email as string | undefined)
  const gmail = google.gmail({ version: 'v1', auth })
  const fromEmail = (input.account_email as string) || process.env.GOOGLE_ACCOUNT_EMAIL || 'me'

  switch (name) {
    case 'gmail_read_inbox': {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        maxResults: (input.max_results as number) || 10,
        q: (input.query as string) || 'is:unread',
      })

      if (!data.messages?.length) return `No emails found in ${fromEmail}.`

      const emails = await Promise.all(
        data.messages.slice(0, 5).map(async (msg) => {
          const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })
          const headers = full.payload?.headers || []
          const get = (n: string) => headers.find((h) => h.name === n)?.value || ''
          return `ID: ${msg.id}\nFrom: ${get('From')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}`
        })
      )
      return `[Account: ${fromEmail}]\n\n` + emails.join('\n\n---\n\n')
    }

    case 'gmail_send_email': {
      const message = [
        `From: ${fromEmail}`,
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        input.body as string,
      ].join('\r\n')

      const encoded = Buffer.from(message).toString('base64url')
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } })
      return `Email sent from ${fromEmail} to ${input.to}`
    }

    case 'gmail_get_email': {
      const { data } = await gmail.users.messages.get({ userId: 'me', id: input.message_id as string, format: 'full' })
      const headers = data.payload?.headers || []
      const get = (n: string) => headers.find((h) => h.name === n)?.value || ''
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
