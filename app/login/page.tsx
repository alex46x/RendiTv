import Link from 'next/link'

export default function LoginDisabled() {
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 text-center space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">Guest Mode</p>
        <h1 className="text-2xl font-semibold text-zinc-900">Login is temporarily disabled</h1>
        <p className="text-zinc-600">
          Use a username from the home page to enter the chat directly.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 transition"
        >
          Go to Guest Join
        </Link>
      </div>
    </div>
  )
}
