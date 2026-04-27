'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function ConnectContent() {
  const params = useSearchParams()
  const success = params.get('success')
  const email = params.get('email')
  const error = params.get('error')
  const token = params.get('token')
  const provider = params.get('provider')

  const [showManual, setShowManual] = useState(false)
  const [refreshToken, setRefreshToken] = useState('')
  const [manualEmail, setManualEmail] = useState('info@i-review.ai')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [envKey, setEnvKey] = useState('')

  const [calendlyKey, setCalendlyKey] = useState('')
  const [calendlyStatus, setCalendlyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [calendlyName, setCalendlyName] = useState('')

  async function testCalendlyKey() {
    if (!calendlyKey.trim()) return
    setCalendlyStatus('testing')
    try {
      const res = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${calendlyKey.trim()}` }
      })
      if (res.ok) {
        const data = await res.json()
        setCalendlyName(data.resource?.name || 'Connected')
        setCalendlyStatus('ok')
      } else {
        setCalendlyStatus('error')
      }
    } catch {
      setCalendlyStatus('error')
    }
  }

  async function saveManualToken() {
    if (!refreshToken.trim()) return
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetch('/api/auth/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken.trim(), email: manualEmail.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        setEnvKey(data.env_key)
        setSaveResult('success')
      } else {
        setSaveResult(data.error || 'Failed to validate token')
      }
    } catch (e) {
      setSaveResult(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (success && token) {
    const envKey = provider === 'microsoft' ? 'MS_REFRESH_TOKEN' : 'GOOGLE_REFRESH_TOKEN'
    return (
      <div>
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">✅</div>
          <h2 className="text-white text-lg font-semibold">Authorized: {email}</h2>
          <p className="text-zinc-400 text-sm mt-1">Add this to Vercel to activate the connection:</p>
        </div>

        <div className="bg-zinc-900 rounded-xl p-4 mb-4">
          <p className="text-zinc-400 text-xs mb-1 font-mono">{envKey}</p>
          <p className="text-emerald-400 font-mono text-xs break-all select-all">{token}</p>
        </div>

        <ol className="text-zinc-400 text-xs space-y-1 mb-5 list-decimal list-inside">
          <li>Go to <strong className="text-white">vercel.com → nexter-studio → Settings → Environment Variables</strong></li>
          <li>Add <strong className="text-white">{envKey}</strong> with the value above</li>
          <li>Redeploy the project</li>
        </ol>

        <a href="/" className="block w-full bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-zinc-100 transition">
          Go to Studio →
        </a>
      </div>
    )
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="text-3xl mb-2">✅</div>
        <h2 className="text-white text-lg font-semibold mb-4">Connected: {email}</h2>
        <a href="/" className="block w-full bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-zinc-100 transition">
          Go to Studio →
        </a>
      </div>
    )
  }

  if (saveResult === 'success') {
    return (
      <div>
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">✅</div>
          <h2 className="text-white text-lg font-semibold">Token validated for {manualEmail}</h2>
          <p className="text-zinc-400 text-sm mt-1">Add this env var to Vercel to activate:</p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 mb-4">
          <p className="text-zinc-400 text-xs mb-1 font-mono">{envKey}</p>
          <p className="text-emerald-400 font-mono text-xs break-all select-all">{refreshToken}</p>
        </div>
        <ol className="text-zinc-400 text-xs space-y-1 mb-5 list-decimal list-inside">
          <li>Go to <strong className="text-white">vercel.com → nexter-studio → Settings → Environment Variables</strong></li>
          <li>Add <strong className="text-white">{envKey}</strong> with the value above</li>
          <li>Redeploy</li>
        </ol>
        <a href="/" className="block w-full bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-zinc-100 transition">
          Go to Studio →
        </a>
      </div>
    )
  }

  if (showManual) {
    return (
      <div>
        <h2 className="text-white text-lg font-semibold mb-2">Manual Token Entry</h2>
        <p className="text-zinc-400 text-xs mb-4">
          Use the <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">OAuth 2.0 Playground</a> to get a refresh token:
        </p>
        <ol className="text-zinc-400 text-xs space-y-2 mb-5 list-decimal list-inside">
          <li>Open the Playground link above</li>
          <li>Click the gear icon → check <strong className="text-white">"Use your own OAuth credentials"</strong></li>
          <li>Enter Client ID: <code className="text-yellow-400 text-xs break-all">723107393219-3j5t5nv1bj8dhgts23ntrhvgo22uv4qk.apps.googleusercontent.com</code></li>
          <li>Enter Client Secret (from your Google Console)</li>
          <li>In Step 1, paste these scopes and click Authorize:
            <div className="bg-zinc-900 rounded p-2 mt-1 font-mono text-xs text-zinc-300 break-all">
              https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events
            </div>
          </li>
          <li>Sign in with <strong className="text-white">info@i-review.ai</strong></li>
          <li>Click <strong className="text-white">"Exchange authorization code for tokens"</strong></li>
          <li>Copy the <strong className="text-white">Refresh token</strong> and paste below</li>
        </ol>

        <div className="space-y-3">
          <div>
            <label className="text-zinc-400 text-xs block mb-1">Email</label>
            <input
              type="email"
              value={manualEmail}
              onChange={e => setManualEmail(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-zinc-400 text-xs block mb-1">Refresh Token</label>
            <textarea
              value={refreshToken}
              onChange={e => setRefreshToken(e.target.value)}
              rows={3}
              placeholder="Paste refresh token here..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          {saveResult && saveResult !== 'success' && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-400 text-xs break-all">{saveResult}</div>
          )}

          <button
            onClick={saveManualToken}
            disabled={saving || !refreshToken.trim()}
            className="w-full bg-white text-black py-3 rounded-lg font-medium hover:bg-zinc-100 transition disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save Token'}
          </button>

          <button onClick={() => setShowManual(false)} className="w-full text-zinc-500 text-sm py-2">
            ← Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="text-center">
      <div className="text-4xl mb-4">🔗</div>
      <h2 className="text-white text-xl font-semibold mb-2">Connect an Account</h2>
      <p className="text-zinc-400 text-sm mb-6">
        Connect Gmail or Microsoft 365 to let the agent read email and manage your calendar.
      </p>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-5 text-left">
          <p className="text-red-400 text-xs font-mono break-all">{error}</p>
          <p className="text-zinc-500 text-xs mt-2">
            If you see &quot;access_denied&quot;, use the manual token option below.
          </p>
        </div>
      )}

      {/* Google */}
      <a
        href="/api/auth/connect"
        className="flex items-center justify-center gap-3 w-full bg-white text-black py-3 rounded-lg font-medium hover:bg-zinc-100 transition mb-3"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
          <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
          <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
          <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
        </svg>
        Connect Google (Gmail + Calendar)
      </a>

      {/* Microsoft */}
      <a
        href="/api/auth/microsoft/connect"
        className="flex items-center justify-center gap-3 w-full bg-[#0078d4] text-white py-3 rounded-lg font-medium hover:bg-[#106ebe] transition mb-4"
      >
        <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
          <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
          <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
          <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
        </svg>
        Connect Microsoft 365 (Outlook + Calendar)
      </a>

      {/* Calendly */}
      <div className="border border-zinc-700 rounded-xl p-4 mb-4 text-left">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📅</span>
          <span className="text-white font-medium text-sm">Connect Calendly</span>
          {calendlyStatus === 'ok' && <span className="text-emerald-400 text-xs ml-auto">✓ Valid</span>}
        </div>
        <p className="text-zinc-400 text-xs mb-3">
          Get your Personal Access Token from{' '}
          <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
            calendly.com → Integrations → API &amp; Webhooks
          </a>
        </p>
        <input
          type="text"
          value={calendlyKey}
          onChange={e => setCalendlyKey(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiJ9..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-zinc-500 mb-2"
        />
        {calendlyStatus === 'ok' && (
          <div className="bg-zinc-900 rounded-lg p-3 mb-2">
            <p className="text-zinc-400 text-xs mb-1">Connected as: <span className="text-white">{calendlyName}</span></p>
            <p className="text-zinc-400 text-xs mb-1 font-mono">CALENDLY_API_KEY</p>
            <p className="text-emerald-400 font-mono text-xs break-all select-all">{calendlyKey}</p>
            <p className="text-zinc-500 text-xs mt-2">→ Add this to Vercel env vars and redeploy</p>
          </div>
        )}
        {calendlyStatus === 'error' && (
          <p className="text-red-400 text-xs mb-2">Invalid token. Check and try again.</p>
        )}
        <button
          onClick={testCalendlyKey}
          disabled={calendlyStatus === 'testing' || !calendlyKey.trim()}
          className="w-full bg-zinc-700 hover:bg-zinc-600 text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-40"
        >
          {calendlyStatus === 'testing' ? 'Checking...' : 'Verify &amp; Show Env Var'}
        </button>
      </div>

      <button
        onClick={() => setShowManual(true)}
        className="w-full text-zinc-500 text-sm py-2 hover:text-zinc-300 transition"
      >
        Can&apos;t sign in? Enter token manually →
      </button>
    </div>
  )
}

export default function ConnectPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold text-white mb-2">Nexter Studio</div>
          <div className="text-zinc-400 text-sm">Connect your Google account</div>
        </div>
        <div className="bg-[#111] border border-zinc-800 rounded-2xl p-8">
          <Suspense>
            <ConnectContent />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
