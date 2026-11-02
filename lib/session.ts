import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Who is signed in, checked against the token's signature rather than
 * trusted from the cookie. Cached so one request checks it once.
 */
export const getSession = cache(async (): Promise<{ userId: string } | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  return { userId: sub };
});

export async function clearSession(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
}
