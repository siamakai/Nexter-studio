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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/na-logo.svg"
            alt="Nexter AI Agency"
            style={{ width: 300, height: 'auto' }}
            className="mx-auto mb-6"
          />
          <h1 className="text-xl font-semibold text-gray-900">Nexter Studio</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your access code to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Access Code</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter your code"
                autoFocus
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-11 text-gray-900 text-sm focus:outline-none focus:border-gray-400 tracking-widest placeholder:tracking-normal"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-xs mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-medium transition-colors"
          >
            {loading ? 'Verifying...' : 'Enter Studio'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Nexter AI Group · Private Access
        </p>
      </div>
    </div>
  )
}
