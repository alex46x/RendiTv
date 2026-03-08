export type GuestSession = {
  id: string
  username: string
}

const STORAGE_KEY = 'randomchat-guest-session'
const GUEST_SESSION_EVENT = 'randomchat-guest-session-change'
let cachedRaw: string | null | undefined
let cachedSession: GuestSession | null | undefined

function generateGuestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `guest_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export function readGuestSession() {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw === cachedRaw && cachedSession !== undefined) {
      return cachedSession
    }

    if (!raw) {
      cachedRaw = null
      cachedSession = null
      return null
    }

    const parsed = JSON.parse(raw) as Partial<GuestSession>

    if (typeof parsed.id !== 'string' || typeof parsed.username !== 'string') {
      cachedRaw = raw
      cachedSession = null
      return null
    }

    cachedRaw = raw
    cachedSession = {
      id: parsed.id,
      username: parsed.username,
    }

    return cachedSession
  } catch {
    cachedRaw = null
    cachedSession = null
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

  const raw = JSON.stringify(session)
  window.localStorage.setItem(STORAGE_KEY, raw)
  cachedRaw = raw
  cachedSession = session
  window.dispatchEvent(new Event(GUEST_SESSION_EVENT))

  return session
}

export function clearGuestSession() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
  cachedRaw = null
  cachedSession = null
  window.dispatchEvent(new Event(GUEST_SESSION_EVENT))
}

export function subscribeToGuestSession(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cachedRaw = undefined
      cachedSession = undefined
      onStoreChange()
    }
  }

  const handleGuestSessionChange = () => {
    onStoreChange()
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(GUEST_SESSION_EVENT, handleGuestSessionChange)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(GUEST_SESSION_EVENT, handleGuestSessionChange)
  }
}
