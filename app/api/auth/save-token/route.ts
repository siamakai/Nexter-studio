import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/google'

// Validates a Google refresh token and returns the env var name to set
export async function POST(req: NextRequest) {
  try {
    const { refresh_token, email } = await req.json()
    if (!refresh_token || !email) {
      return NextResponse.json({ error: 'refresh_token and email required' }, { status: 400 })
    }

    // Verify it works
    const client = getOAuthClient()
    client.setCredentials({ refresh_token })
    const { token } = await client.getAccessToken()
    if (!token) {
      return NextResponse.json({ error: 'Could not obtain access token — refresh token may be invalid.' }, { status: 400 })
    }

    const isPrimary = email === process.env.GOOGLE_ACCOUNT_EMAIL
    const envKey = isPrimary
      ? 'GOOGLE_REFRESH_TOKEN'
      : `GOOGLE_REFRESH_TOKEN_${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

    return NextResponse.json({ ok: true, email, env_key: envKey, refresh_token })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
