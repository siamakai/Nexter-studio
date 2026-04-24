import { NextRequest, NextResponse } from 'next/server'
import { getMsTokensFromCode } from '@/lib/microsoft'

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

    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()
    const email = profile.mail || profile.userPrincipalName
    const refreshToken = tokens.refresh_token

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connect?success=true&email=${email}&token=${encodeURIComponent(refreshToken)}&provider=microsoft`
    )
  } catch (err) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/connect?error=${encodeURIComponent(String(err))}`)
  }
}
