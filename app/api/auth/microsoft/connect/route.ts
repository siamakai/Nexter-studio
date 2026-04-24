import { NextResponse } from 'next/server'
import { getMsAuthUrl } from '@/lib/microsoft'

export async function GET() {
  return NextResponse.redirect(getMsAuthUrl())
}
