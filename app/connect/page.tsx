'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function ConnectContent() {
  const params = useSearchParams()
  const success = params.get('success')
  const email = params.get('email')
  const error = params.get('error')

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold text-white mb-2">Nexter Studio</div>
          <div className="text-zinc-400 text-sm">Connect your Google account</div>
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-2xl p-8">
          {success ? (
            <div className="text-center">
              <div className="text-4xl mb-4">✅</div>
              <h2 className="text-white text-xl font-semibold mb-2">Connected!</h2>
              <p className="text-zinc-400 text-sm mb-1">
                Gmail and Calendar are now linked to
              </p>
              <p className="text-emerald-400 font-mono text-sm mb-6">{email}</p>
              <p className="text-zinc-500 text-xs mb-6">
                The agent can now read your inbox, send emails, and manage your calendar.
              </p>
              <a
                href="/"
                className="block w-full bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-zinc-100 transition"
              >
                Go to Studio →
              </a>
            </div>
          ) : error ? (
            <div className="text-center">
              <div className="text-4xl mb-4">❌</div>
              <h2 className="text-white text-xl font-semibold mb-2">Connection failed</h2>
              <p className="text-zinc-400 text-sm mb-4 font-mono break-all">{error}</p>
              <button
                onClick={() => window.location.href = '/api/auth/connect'}
                className="block w-full bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-zinc-100 transition"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-4xl mb-4">🔗</div>
              <h2 className="text-white text-xl font-semibold mb-2">Connect Google Account</h2>
              <p className="text-zinc-400 text-sm mb-6">
                Allow Nexter Studio to access Gmail and Google Calendar so the agent can read your inbox, send emails, and manage events.
              </p>

              <div className="bg-zinc-900 rounded-xl p-4 mb-6 text-left space-y-2">
                <div className="flex items-center gap-2 text-sm text-zinc-300">
                  <span>📧</span>
                  <span>Read and send Gmail</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-300">
                  <span>📅</span>
                  <span>View and create Calendar events</span>
                </div>
              </div>

              <a
                href="/api/auth/connect"
                className="flex items-center justify-center gap-3 w-full bg-white text-black py-3 rounded-lg font-medium hover:bg-zinc-100 transition"
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                  <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                  <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                  <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
                </svg>
                Continue with Google
              </a>

              <p className="text-zinc-600 text-xs mt-4">
                Your tokens are stored securely and used only by your agent.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectContent />
    </Suspense>
  )
}
