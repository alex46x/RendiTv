'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'

type AuthContextType = {
  user: User | null
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let active = true

    const ensureProfile = async (currentUser: User | null) => {
      if (!currentUser) {
        return
      }

      const { data: existingProfile, error: profileLookupError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', currentUser.id)
        .maybeSingle()

      if (profileLookupError) {
        console.error('Profile lookup failed:', profileLookupError)
        return
      }

      if (existingProfile) {
        return
      }

      const metadataUsername =
        typeof currentUser.user_metadata?.username === 'string'
          ? currentUser.user_metadata.username.trim()
          : ''
      const emailPrefix = currentUser.email?.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '') ?? 'user'
      const fallbackUsername = `${emailPrefix || 'user'}_${currentUser.id.slice(0, 8)}`
      const username = metadataUsername || fallbackUsername

      const { error: insertError } = await supabase.from('profiles').insert({
        id: currentUser.id,
        username,
      })

      if (insertError && insertError.code !== '23505') {
        console.error('Profile creation failed:', insertError)
      }
    }

    const syncUser = async (currentUser: User | null) => {
      await ensureProfile(currentUser)

      if (!active) {
        return
      }

      setUser(currentUser)
      setLoading(false)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      void syncUser(session?.user ?? null)
    })

    const loadUser = async () => {
      const result = await supabase.auth.getUser()
      await syncUser(result.data.user)
    }

    void loadUser()

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
