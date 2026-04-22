import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOAuthClient } from '@/lib/google'

export async function POST(req: NextRequest) {
  try {
    const { refresh_token, email } = await req.json()

    if (!refresh_token || !email) {
      return NextResponse.json({ error: 'refresh_token and email required' }, { status: 400 })
    }

    // Verify the refresh token works by getting an access token
    const client = getOAuthClient()
    client.setCredentials({ refresh_token })

    let access_token: string | null | undefined
    let expiry_date: number | null | undefined

    try {
      const { token, res } = await client.getAccessToken()
      access_token = token
      expiry_date = (res?.data as { expiry_date?: number })?.expiry_date ?? null
    } catch (err) {
      return NextResponse.json({ error: `Invalid refresh token: ${String(err)}` }, { status: 400 })
    }

    if (!access_token) {
      return NextResponse.json({ error: 'Could not obtain access token from refresh token' }, { status: 400 })
    }

    // Save to Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error: dbError } = await supabase.from('google_tokens').upsert({
      email,
      access_token,
      refresh_token,
      expiry_date,
    }, { onConflict: 'email' })

    if (dbError) {
      return NextResponse.json({ error: `DB error: ${dbError.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, email })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
