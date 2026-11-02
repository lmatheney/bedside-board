export function cleanName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) return null;
  if (!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name)) return null;
  return name;
}

/** First name plus last initial. A single given name is left as-is. */
export function publicName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "Someone";
  const last = parts[parts.length - 1] ?? "";
  const first = parts.slice(0, -1).join(" ");
  const initial = last[0]?.toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}
