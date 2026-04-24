import { NextResponse } from 'next/server'

export async function GET() {
  const googleEmail = process.env.GOOGLE_ACCOUNT_EMAIL || null
  const msEmail = process.env.MS_ACCOUNT_EMAIL || null

  return NextResponse.json({
    google: {
      email: googleEmail,
      connected: !!process.env.GOOGLE_REFRESH_TOKEN,
    },
    microsoft: {
      email: msEmail,
      connected: !!process.env.MS_REFRESH_TOKEN,
    },
  })
}
