import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { one, run } from "@/lib/db";
import { sha256 } from "@/lib/hash";

const COOKIE = "bedside_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + THIRTY_DAYS * 1000);
  run(
    `insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)`,
    sha256(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, cookieOptions(THIRTY_DAYS));
}

export async function getSession(): Promise<{ userId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const row = one<{ user_id: string; expires_at: string }>(
    `select user_id, expires_at from sessions where token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    run(`delete from sessions where token_hash = ?`, sha256(token));
    return null;
  }
  return { userId: row.user_id };
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) run(`delete from sessions where token_hash = ?`, sha256(token));
  jar.set(COOKIE, "", cookieOptions(0));
}
