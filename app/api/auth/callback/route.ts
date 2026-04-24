import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/google'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  const oauthError = req.nextUrl.searchParams.get('error')
  if (oauthError) {
    const msg = oauthError === 'access_denied'
      ? 'access_denied — use the manual token option instead.'
      : oauthError
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${encodeURIComponent(msg)}`)
  }

  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=No+authorization+code+received`)
  }

  try {
    const client = getOAuthClient()
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const { data: userInfo } = await oauth2.userinfo.get()
    const email = userInfo.email!
    const refreshToken = tokens.refresh_token!

    // Redirect to connect page with token shown — user adds to Vercel env vars
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?success=true&email=${email}&token=${encodeURIComponent(refreshToken)}&provider=google`
    )
  } catch (err) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${encodeURIComponent(String(err))}`)
  }
}
