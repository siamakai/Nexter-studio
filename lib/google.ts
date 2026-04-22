import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
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

export async function getAuthedClient() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data } = await supabase
    .from('google_tokens')
    .select('*')
    .eq('email', process.env.GOOGLE_ACCOUNT_EMAIL || 'default')
    .single()

  if (!data) throw new Error('Google account not connected. Visit /connect to authorize.')

  const client = getOAuthClient()
  client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date,
  })

  // Persist refreshed tokens back to Supabase
  client.on('tokens', async (tokens) => {
    const update: Record<string, unknown> = {}
    if (tokens.access_token) update.access_token = tokens.access_token
    if (tokens.expiry_date) update.expiry_date = tokens.expiry_date
    if (Object.keys(update).length) {
      await supabase.from('google_tokens').update(update).eq('email', data.email)
    }
  })

  // Force refresh now if token is expired or missing
  const isExpired = !data.access_token || (data.expiry_date && Date.now() > data.expiry_date - 60000)
  if (isExpired) {
    await client.getAccessToken()
  }

  return client
}
