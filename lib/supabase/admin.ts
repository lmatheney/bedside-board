import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Bypasses row-level security. Server only, and only for things a signed-in
 * person can't do for themselves: look up phone numbers, create sign-in
 * accounts for people a mod adds, and check that a page exists before
 * anyone has signed in. Never pass anything it returns to a follower
 * without checking their role first.
 */
export function createAdminSupabase() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
