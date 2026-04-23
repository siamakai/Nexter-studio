import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Return ALL connected accounts
    const { data, error } = await supabase
      .from('google_tokens')
      .select('email, expiry_date, created_at')
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const now = Date.now()
    const accounts = (data || []).map((row) => ({
      email: row.email,
      connected_at: row.created_at,
      is_expired: row.expiry_date ? now > row.expiry_date : false,
    }))

    return NextResponse.json({
      primary_account: process.env.GOOGLE_ACCOUNT_EMAIL || null,
      connected_accounts: accounts,
      total: accounts.length,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
