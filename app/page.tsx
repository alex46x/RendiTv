'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { writeGuestSession } from '@/lib/guest-session'

export default function Home() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()

    const normalizedUsername = username.trim()

    if (normalizedUsername.length < 3) {
      setError('Enter a username with at least 3 characters.')
      return
    }

    writeGuestSession(normalizedUsername)
    router.push('/chat')
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">Guest Mode</p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-zinc-900">
            Join instantly, <br />
            <span className="text-indigo-600">just with a username.</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-600 max-w-2xl mx-auto">
            Login is temporarily disabled. Pick a username and jump straight into the random video chat queue.
          </p>
        </div>

        <form onSubmit={handleJoin} className="max-w-md mx-auto bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 text-left space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="w-full px-8 py-4 bg-indigo-600 text-white rounded-full font-medium text-lg hover:bg-indigo-700 transition shadow-sm"
          >
            Join Chat
          </button>
        </form>
      </div>

      <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl w-full">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-100">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4 text-indigo-600 font-bold text-xl">1</div>
          <h3 className="text-xl font-semibold text-zinc-900 mb-2">Choose Username</h3>
          <p className="text-zinc-600">Type any username you want to use for this browser session.</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-100">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4 text-indigo-600 font-bold text-xl">2</div>
          <h3 className="text-xl font-semibold text-zinc-900 mb-2">Enter Queue</h3>
          <p className="text-zinc-600">Go directly into guest mode without signup, password, or email verification.</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-100">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4 text-indigo-600 font-bold text-xl">3</div>
          <h3 className="text-xl font-semibold text-zinc-900 mb-2">Chat & Skip</h3>
          <p className="text-zinc-600">Talk to a random stranger, then skip to the next one whenever you want.</p>
        </div>
      </div>
    </div>
  )
}
