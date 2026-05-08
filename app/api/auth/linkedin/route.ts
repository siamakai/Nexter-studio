import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID     = process.env.LINKEDIN_CLIENT_ID!
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET!
const REDIRECT_URI  = process.env.LINKEDIN_REDIRECT_URI!  // https://va.nexterai.agency/api/auth/linkedin/callback

// Step 1: redirect to LinkedIn OAuth
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')

  if (action === 'callback') {
    // Step 2: exchange code for token
    const code = req.nextUrl.searchParams.get('code')
    if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = await res.json()

    if (!res.ok) {
      return new Response(
        `<html><body style="font-family:sans-serif;padding:40px">
          <h2>LinkedIn Auth Failed</h2>
          <pre>${JSON.stringify(data, null, 2)}</pre>
        </body></html>`, { headers: { 'Content-Type': 'text/html' } }
      )
    }

    return new Response(
      `<html><body style="font-family:sans-serif;padding:40px;max-width:600px">
        <h2 style="color:#0A66C2">✅ LinkedIn Connected</h2>
        <p>Access token received. Add this to your Vercel environment variables:</p>
        <p><strong>LINKEDIN_ACCESS_TOKEN</strong></p>
        <textarea style="width:100%;height:120px;font-family:monospace;font-size:12px;padding:10px;border:1px solid #ccc;border-radius:6px" readonly>${data.access_token}</textarea>
        <p style="color:#666;font-size:13px">Token expires in ${Math.round(data.expires_in / 86400)} days. After adding to Vercel, redeploy.</p>
        <p style="color:#666;font-size:13px">Also set <strong>LINKEDIN_PERSON_URN</strong> — get it by calling the /v2/me endpoint with this token.</p>
        <script>document.querySelector('textarea').select()</script>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  }

  // Default: initiate OAuth
  const scopes = ['r_liteprofile', 'r_emailaddress', 'w_member_social'].join(' ')
  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', 'linkedin_connect')

  return NextResponse.redirect(authUrl.toString())
}
