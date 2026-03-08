import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseConfig } from './config'

let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (!browserClient) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig()
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }

  return browserClient
}
