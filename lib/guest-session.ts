export type GuestSession = {
  id: string
  username: string
}

const STORAGE_KEY = 'randomchat-guest-session'

function generateGuestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `guest_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export function readGuestSession() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<GuestSession>

    if (typeof parsed.id !== 'string' || typeof parsed.username !== 'string') {
      return null
    }

    return {
      id: parsed.id,
      username: parsed.username,
    }
  } catch {
    return null
  }
}

export function writeGuestSession(username: string) {
  const normalizedUsername = username.trim()
  const existing = readGuestSession()

  const session: GuestSession = {
    id: existing?.id ?? generateGuestId(),
    username: normalizedUsername,
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))

  return session
}

export function clearGuestSession() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}
