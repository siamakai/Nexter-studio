import { NextRequest, NextResponse } from 'next/server'
import { getMsTokensFromCode } from '@/lib/microsoft'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get('error')
  if (error) {
    const desc = req.nextUrl.searchParams.get('error_description') || error
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${encodeURIComponent(desc)}`)
  }

  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=No+authorization+code+received`)
  }

  try {
    const tokens = await getMsTokensFromCode(code)
    const expiry_date = Date.now() + tokens.expires_in * 1000

    // Get user email from Microsoft Graph
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()
    const email = profile.mail || profile.userPrincipalName

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    await supabase.from('microsoft_tokens').upsert({
      email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date,
    }, { onConflict: 'email' })

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?success=true&email=${email}&provider=microsoft`)
  } catch (err) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${encodeURIComponent(String(err))}`)
  }
}
