const TOKEN_URL = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID || 'common'}/oauth2/v2.0/token`
const AUTH_URL = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID || 'common'}/oauth2/v2.0/authorize`

export const MS_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'offline_access',
].join(' ')

export function getMsAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft/callback`,
    scope: MS_SCOPES,
    response_mode: 'query',
    prompt: 'consent',
  })
  return `${AUTH_URL}?${params}`
}

export async function getMsTokensFromCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft/callback`,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`MS token exchange failed: ${await res.text()}`)
  return res.json()
}

async function refreshMsToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: MS_SCOPES,
    }),
  })
  if (!res.ok) throw new Error(`MS token refresh failed: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

export async function getMsAccessToken(email: string): Promise<string> {
  // Env var: MS_REFRESH_TOKEN for primary, MS_REFRESH_TOKEN_SIAMAK for others
  const isPrimary = email === process.env.MS_ACCOUNT_EMAIL
  const refreshToken = isPrimary
    ? process.env.MS_REFRESH_TOKEN
    : process.env[`MS_REFRESH_TOKEN_${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]

  if (!refreshToken) {
    throw new Error(`Microsoft account ${email} not connected. Add MS_REFRESH_TOKEN to Vercel env vars. Get it from /connect.`)
  }

  return refreshMsToken(refreshToken)
}

export async function graphFetch(email: string, path: string, options: RequestInit = {}) {
  const token = await getMsAccessToken(email)
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`)
  if (res.status === 204) return {}
  return res.json()
}
