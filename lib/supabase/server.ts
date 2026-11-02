import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_MAX_AGE_SECONDS, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * A client that acts as the signed-in person. Row-level security applies,
 * so it can only read what that person is allowed to read.
 *
 * One per request (React cache), so a session created by verifyOtp is
 * already in memory for the rest of the same request.
 */
export const createServerSupabase = cache(async () => {
  const jar = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: { maxAge: SESSION_MAX_AGE_SECONDS },
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) jar.set(name, value, options);
        } catch {
          // Server Components can't write cookies. proxy.ts refreshes the
          // session on every request, so this is safe to skip.
        }
      },
    },
  });
});
