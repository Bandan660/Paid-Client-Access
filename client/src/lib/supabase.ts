import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase Client] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing from client environment.');
}

/**
 * Browser-safe Supabase Client
 * Uses only the public Anon key. Row-Level Security (RLS) is strictly enforced
 * on all SELECT, INSERT, and UPDATE queries based on the user's active auth JWT.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
