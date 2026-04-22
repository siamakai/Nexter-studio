import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const accountEmail = process.env.GOOGLE_ACCOUNT_EMAIL || '(not set)'

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase
      .from('google_tokens')
      .select('email, expiry_date, created_at')
      .eq('email', accountEmail)
      .single()

    const now = Date.now()
    const expired = data?.expiry_date ? now > data.expiry_date : null

    return NextResponse.json({
      account_email: accountEmail,
      table_error: error?.message || null,
      token_found: !!data,
      token_email: data?.email || null,
      expiry_date: data?.expiry_date || null,
      is_expired: expired,
      now,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
