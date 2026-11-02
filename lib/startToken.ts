import "server-only";
import { createHmac } from "node:crypto";
import { hashesMatch } from "@/lib/hash";
import { supabaseSecretKey } from "@/lib/supabase/env";

/**
 * Starting a page takes two trips: the owner asks for a sign-in link, then
 * clicks it. What they typed (patient, name) rides in this cookie in between.
 * It is signed, so only a request that passed the setup code can make one.
 */
export const START_COOKIE = "bedside_start";
export const START_MAX_AGE_SECONDS = 60 * 60;

export type StartDetails = { patient: string; name: string; email: string };

function mac(body: string): string {
  return createHmac("sha256", supabaseSecretKey()).update(body).digest("base64url");
}

export function signStart(details: StartDetails): string {
  const body = Buffer.from(JSON.stringify({ ...details, exp: Date.now() + START_MAX_AGE_SECONDS * 1000 })).toString(
    "base64url",
  );
  return `${body}.${mac(body)}`;
}

export function readStart(token: string | undefined): StartDetails | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature || !hashesMatch(signature, mac(body))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<StartDetails> & {
      exp?: number;
    };
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    if (typeof parsed.patient !== "string" || typeof parsed.name !== "string" || typeof parsed.email !== "string") {
      return null;
    }
    return { patient: parsed.patient, name: parsed.name, email: parsed.email };
  } catch {
    return null;
  }
}
