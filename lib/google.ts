import { google } from 'googleapis'

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
]

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
  )
}

export function getAuthUrl() {
  const client = getOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })
}

export async function getAuthedClient(emailOverride?: string) {
  // Support multiple accounts via env vars: GOOGLE_REFRESH_TOKEN, GOOGLE_REFRESH_TOKEN_2, etc.
  // Or a specific account key like GOOGLE_REFRESH_TOKEN_INFO (mapped by email)
  const email = emailOverride || process.env.GOOGLE_ACCOUNT_EMAIL
  if (!email) throw new Error('No Google account email configured.')

  // Derive env var name from email: info@i-review.ai → GOOGLE_REFRESH_TOKEN (primary)
  // secondary accounts: GOOGLE_REFRESH_TOKEN_SIAMAK, etc.
  const isPrimary = email === process.env.GOOGLE_ACCOUNT_EMAIL
  const refreshToken = isPrimary
    ? process.env.GOOGLE_REFRESH_TOKEN
    : process.env[`GOOGLE_REFRESH_TOKEN_${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]

  if (!refreshToken) {
    throw new Error(`No refresh token found for ${email}. Add GOOGLE_REFRESH_TOKEN to Vercel env vars. Get it from /connect.`)
  }

  const client = getOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })

  // Ensure we have a valid access token
  const { token } = await client.getAccessToken()
  if (!token) throw new Error(`Could not obtain access token for ${email}. Try reconnecting at /connect.`)

  return client
}
