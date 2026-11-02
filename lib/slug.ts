import { randomBytes } from "node:crypto";

export function isSlug(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,24}$/.test(value);
}

export function newSlug(): string {
  return randomBytes(9).toString("base64url");
}

export function slugFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isSlug(trimmed)) return trimmed;
  const match = trimmed.match(/\/p\/([A-Za-z0-9_-]{8,24})(?:[/?#]|$)/);
  return match?.[1] ?? null;
}
