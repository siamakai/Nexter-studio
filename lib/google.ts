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
  const accountEmail = process.env.GOOGLE_ACCOUNT_EMAIL
  if (!accountEmail) throw new Error('GOOGLE_ACCOUNT_EMAIL env var not set.')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('google_tokens')
    .select('*')
    .eq('email', accountEmail)
    .single()

  if (error) throw new Error(`DB error fetching tokens: ${error.message}. Visit /connect to authorize.`)
  if (!data) throw new Error(`No Google tokens found for ${accountEmail}. Visit /connect to authorize.`)
  if (!data.refresh_token) throw new Error(`No refresh token for ${accountEmail}. Visit /connect to re-authorize.`)

  const client = getOAuthClient()
  client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date,
  })

  // Persist any refreshed tokens back to Supabase
  client.on('tokens', async (tokens) => {
    const update: Record<string, unknown> = {}
    if (tokens.access_token) update.access_token = tokens.access_token
    if (tokens.expiry_date) update.expiry_date = tokens.expiry_date
    if (tokens.refresh_token) update.refresh_token = tokens.refresh_token
    if (Object.keys(update).length) {
      await supabase.from('google_tokens').update(update).eq('email', accountEmail)
    }
  })

  // Always get a fresh access token (googleapis handles caching; refreshes if expired)
  const { token } = await client.getAccessToken()
  if (!token) throw new Error(`Could not obtain access token for ${accountEmail}. Try re-connecting at /connect.`)

  return client
}
