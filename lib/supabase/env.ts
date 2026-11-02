function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in (see the Supabase project's Connect dialog).`);
  }
  return value;
}

export function supabaseUrl(): string {
  return need("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabasePublishableKey(): string {
  return need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function supabaseSecretKey(): string {
  return need("SUPABASE_SECRET_KEY");
}

/** Followers stay signed in for 30 days from their last visit. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
