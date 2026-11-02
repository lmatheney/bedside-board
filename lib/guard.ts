import "server-only";
import { getMember, getPageBySlug, pageIdForSlug } from "@/lib/data";
import { isSlug } from "@/lib/slug";
import { getSession } from "@/lib/session";
import type { CarePage, CurrentMember, Role } from "@/lib/types";

export type LoadedPage =
  | { kind: "missing" }
  | { kind: "signed-out" }
  | { kind: "forbidden" }
  | { kind: "ready"; page: CarePage; member: CurrentMember };

export async function loadPage(slug: string): Promise<LoadedPage> {
  if (!isSlug(slug)) return { kind: "missing" };
  const session = await getSession();
  if (!session) {
    // Nobody is signed in, so the database hides every page. Only check that it exists.
    return (await pageIdForSlug(slug)) ? { kind: "signed-out" } : { kind: "missing" };
  }
  // Row-level security returns the page only to people who are on it.
  const page = await getPageBySlug(slug);
  if (!page) return (await pageIdForSlug(slug)) ? { kind: "forbidden" } : { kind: "missing" };
  const member = await getMember(page.id, session.userId);
  if (!member) return { kind: "forbidden" };
  return { kind: "ready", page, member };
}

export function allows(member: CurrentMember, roles: Role[]): boolean {
  return roles.includes(member.role);
}
