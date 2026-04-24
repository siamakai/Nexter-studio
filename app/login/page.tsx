'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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
          <Image
            src="/nexter-ai-group-logo.svg"
            alt="Nexter AI Group"
            width={140}
            height={38}
            className="mx-auto mb-6"
            priority
          />
          <h1 className="text-xl font-semibold text-gray-900">Nexter Studio</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your access code to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Access Code</label>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter your code"
              autoFocus
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-sm focus:outline-none focus:border-gray-400 tracking-widest placeholder:tracking-normal"
            />
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
