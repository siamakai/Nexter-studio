import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { code } = await req.json()
  const correct = process.env.STUDIO_PASSWORD

  if (!correct) return NextResponse.json({ error: 'STUDIO_PASSWORD not configured' }, { status: 500 })
  if (code !== correct) return NextResponse.json({ error: 'Invalid code' }, { status: 401 })

  const res = NextResponse.json({ ok: true })
  res.cookies.set('studio_auth', correct, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('studio_auth')
  return res
}
