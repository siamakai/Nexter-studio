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
  })

  // Auto-refresh if expired
  client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await supabase.from('google_tokens').update({ access_token: tokens.access_token }).eq('email', data.email)
    }
  })

  return client
}
