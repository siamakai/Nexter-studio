import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/connect', '/api/auth/callback', '/api/auth/microsoft', '/api/auth/save-token']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/nexter-ai-group-logo') ||
    pathname.startsWith('/na-logo') ||
    pathname.startsWith('/nexter-ai-agency-logo') ||
    /\.(svg|png|jpg|jpeg|webp|ico|gif)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  const password = process.env.STUDIO_PASSWORD
  if (!password) return NextResponse.next() // no password set = open access

  const cookie = req.cookies.get('studio_auth')
  if (cookie?.value === password) return NextResponse.next()

  // Not authenticated — redirect to login
  const loginUrl = new URL('/login', req.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.webp|.*\\.ico|.*\\.gif).*)'],
}
