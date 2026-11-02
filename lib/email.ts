/**
 * Trims and lowercases an email address, or returns null if it doesn't look
 * like one. Supabase Auth stores emails in lowercase, so everything compares
 * in lowercase too.
 */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@,;|]+@[^\s@,;|]+\.[^\s@,;|]{2,}$/.test(email)) return null;
  return email;
}
