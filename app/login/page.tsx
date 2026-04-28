'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    })
    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      setError('Incorrect access code. Please try again.')
      setCode('')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#1C2B4A' }}>
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nexter-group-logo.svg" alt="Nexter AI Group" className="mx-auto mb-8" style={{ width: 300, height: 'auto' }} />
          <div style={{ width: 40, height: 1, background: '#B8963E', margin: '0 auto 20px' }} />
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, letterSpacing: '0.15em', fontFamily: 'Courier New, monospace', textTransform: 'uppercase' }}>
            Private Access
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ background: '#243558', border: '1px solid rgba(184,150,62,0.3)', borderRadius: 16, padding: 32 }}>
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.15em', color: 'rgba(248,244,238,0.45)', fontFamily: 'Courier New, monospace', textTransform: 'uppercase', marginBottom: 10 }}>
            Access Code
          </label>
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter your code"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#162036', border: '1px solid rgba(184,150,62,0.35)',
                borderRadius: 10, padding: '12px 44px 12px 16px',
                color: '#F8F4EE', fontSize: 14, outline: 'none',
                letterSpacing: '0.15em', fontFamily: 'Courier New, monospace',
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,244,238,0.35)', padding: 0 }}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {error && (
            <p style={{ color: '#C0392B', fontSize: 12, marginBottom: 16, fontFamily: 'Courier New, monospace' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            style={{
              width: '100%', padding: '13px',
              background: loading || !code.trim() ? 'rgba(184,150,62,0.3)' : '#B8963E',
              border: 'none', borderRadius: 10, cursor: loading || !code.trim() ? 'not-allowed' : 'pointer',
              color: '#08080D', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.12em', fontFamily: 'Georgia, serif',
              transition: 'background 0.2s',
            }}
          >
            {loading ? 'Verifying...' : 'Enter Studio'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 24, letterSpacing: '0.1em', fontFamily: 'Courier New, monospace' }}>
NEXTER AI GROUP · RESPONSIBLE AI ECOSYSTEM
        </p>
      </div>
    </div>
  )
}
