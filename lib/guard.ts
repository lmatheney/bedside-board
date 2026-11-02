import "server-only";
import { getMember, getPageBySlug } from "@/lib/data";
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
  const page = getPageBySlug(slug);
  if (!page) return { kind: "missing" };
  const session = await getSession();
  if (!session) return { kind: "signed-out" };
  const member = getMember(page.id, session.userId);
  if (!member) return { kind: "forbidden" };
  return { kind: "ready", page, member };
}

export function allows(member: CurrentMember, roles: Role[]): boolean {
  return roles.includes(member.role);
}
