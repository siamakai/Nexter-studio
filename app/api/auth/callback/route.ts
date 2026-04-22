import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/google'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  // Google sends ?error=access_denied when the user cancels or the app isn't verified
  const oauthError = req.nextUrl.searchParams.get('error')
  if (oauthError) {
    const msg = oauthError === 'access_denied'
      ? 'access_denied — your Google account may not be whitelisted. Use the manual token option.'
      : oauthError
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${encodeURIComponent(msg)}`)
  }

  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=No+authorization+code+received`)

  try {
    const client = getOAuthClient()
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const { data: userInfo } = await oauth2.userinfo.get()
    const email = userInfo.email!

    // Save tokens to Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('google_tokens').upsert({
      email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    }, { onConflict: 'email' })

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?success=true&email=${email}`)
  } catch (err) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${String(err)}`)
  }
}
