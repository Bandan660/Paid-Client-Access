import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[SupabaseAdmin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables.');
}

/**
 * Server-only Supabase Admin Client
 * Bypasses RLS to allow webhook processing, entitlement granting, and CRM sync logging.
 * NEVER exposed to client.
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
