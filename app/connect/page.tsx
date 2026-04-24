'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function ConnectContent() {
  const params = useSearchParams()
  const success = params.get('success')
  const email = params.get('email')
  const error = params.get('error')

  const [showManual, setShowManual] = useState(false)
  const [refreshToken, setRefreshToken] = useState('')
  const [manualEmail, setManualEmail] = useState('info@i-review.ai')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

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
        setSaveResult('success')
      } else {
        setSaveResult(data.error || 'Failed to save token')
      }
    } catch (e) {
      setSaveResult(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-white text-xl font-semibold mb-2">Connected!</h2>
        <p className="text-zinc-400 text-sm mb-1">Gmail and Calendar are now linked to</p>
        <p className="text-emerald-400 font-mono text-sm mb-6">{email}</p>
        <a href="/" className="block w-full bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-zinc-100 transition">
          Go to Studio →
        </a>
      </div>
    )
  }

  if (saveResult === 'success') {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-white text-xl font-semibold mb-2">Token saved!</h2>
        <p className="text-zinc-400 text-sm mb-6">Gmail and Calendar are now connected for <span className="text-emerald-400">{manualEmail}</span>.</p>
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
