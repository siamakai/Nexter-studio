import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/google'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  // Derive base URL from request if env var is missing
  const base = process.env.NEXT_PUBLIC_APP_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`

  const oauthError = req.nextUrl.searchParams.get('error')
  if (oauthError) {
    const msg = oauthError === 'access_denied'
      ? 'access_denied — use the manual token option instead.'
      : oauthError
    return NextResponse.redirect(`${base}/connect?error=${encodeURIComponent(msg)}`)
  }

  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(`${base}/connect?error=No+authorization+code+received`)
  }

  try {
    const client = getOAuthClient()
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const { data: userInfo } = await oauth2.userinfo.get()
    const email = userInfo.email || ''
    const refreshToken = tokens.refresh_token || ''

    if (!refreshToken) {
      // Google only returns refresh_token on first consent — force re-consent
      return NextResponse.redirect(`${base}/connect?error=No+refresh+token+returned.+Please+revoke+app+access+at+myaccount.google.com%2Fpermissions+then+try+again.`)
    }

    return NextResponse.redirect(
      `${base}/connect?success=true&email=${encodeURIComponent(email)}&token=${encodeURIComponent(refreshToken)}&provider=google`
    )
  } catch (err) {
    return NextResponse.redirect(`${base}/connect?error=${encodeURIComponent(String(err))}`)
  }
}
