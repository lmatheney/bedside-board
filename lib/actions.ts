"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addPeople,
  addPerson,
  changeTier,
  createPage,
  editUpdate,
  getPageBySlug,
  handOff,
  publishUpdate,
  quickCheckIn,
  removePerson,
  requestLoginCode,
  setHidden,
  setPinnedNote,
  setReaction,
  verifyLoginCode,
} from "@/lib/data";
import { ActionError } from "@/lib/errors";
import { allows, loadPage } from "@/lib/guard";
import { isSlug, slugFromInput } from "@/lib/slug";
import { canManagePeople, canPost } from "@/lib/status";
import { clearSession, createSession, setSessionCookie } from "@/lib/session";
import type { CurrentMember, FormState, PublishInput } from "@/lib/types";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ActionError) return { ok: false, error: error.message };
  throw error;
}

async function readyMember(slug: string): Promise<{ pageId: string; member: CurrentMember }> {
  if (!isSlug(slug)) throw new ActionError("This page doesn't exist.");
  const loaded = await loadPage(slug);
  if (loaded.kind === "missing") throw new ActionError("This page doesn't exist.");
  if (loaded.kind === "signed-out") throw new ActionError("Sign in again.");
  if (loaded.kind === "forbidden") throw new ActionError("You don't have access to this page.");
  return { pageId: loaded.page.id, member: loaded.member };
}

function pagePath(slug: string, error?: string): string {
  if (!isSlug(slug)) return "/";
  return error ? `/p/${slug}?error=${encodeURIComponent(error)}` : `/p/${slug}`;
}

function peoplePath(slug: string, error?: string): string {
  if (!isSlug(slug)) return "/";
  return error ? `/p/${slug}/people?error=${encodeURIComponent(error)}` : `/p/${slug}/people`;
}

function historyPath(slug: string, error?: string): string {
  if (!isSlug(slug)) return "/";
  return error ? `/p/${slug}/history?error=${encodeURIComponent(error)}` : `/p/${slug}/history`;
}

function returnPath(slug: string, value: string): string {
  if (!isSlug(slug)) return "/";
  try {
    const url = new URL(value, "http://bedside.local");
    if (url.origin !== "http://bedside.local") return `/p/${slug}`;
    if (url.pathname !== `/p/${slug}` && url.pathname !== `/p/${slug}/history`) return `/p/${slug}`;
    return url.searchParams.get("view") === "wider" ? `${url.pathname}?view=wider` : url.pathname;
  } catch {
    return `/p/${slug}`;
  }
}

export async function createCarePage(_prev: FormState, formData: FormData): Promise<FormState> {
  let slug = "";
  try {
    const created = createPage({
      patientFirstName: field(formData, "patient"),
      ownerName: field(formData, "name"),
      phone: field(formData, "phone"),
    });
    slug = created.slug;
    await setSessionCookie(createSession(created.userId));
  } catch (error) {
    if (error instanceof ActionError) return { error: error.message };
    throw error;
  }
  redirect(`/p/${slug}`);
}

export async function openExistingPage(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = slugFromInput(field(formData, "link"));
  if (!slug) return { error: "Paste the page link." };
  if (!getPageBySlug(slug)) return { error: "That link doesn't match a page." };
  redirect(`/p/${slug}`);
}

export async function requestCode(
  slug: string,
  phone: string,
): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  try {
    if (!isSlug(slug)) return { ok: false, error: "This page doesn't exist." };
    const page = getPageBySlug(slug);
    if (!page) return { ok: false, error: "This page doesn't exist." };
    const result = requestLoginCode(page.id, phone);
    return { ok: true, devCode: result.devCode };
  } catch (error) {
    return failure(error);
  }
}

export async function verifyCode(
  slug: string,
  phone: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isSlug(slug)) return { ok: false, error: "This page doesn't exist." };
    const page = getPageBySlug(slug);
    if (!page) return { ok: false, error: "This page doesn't exist." };
    const userId = verifyLoginCode(page.id, phone, code);
    await setSessionCookie(createSession(userId));
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function signOut(formData: FormData): Promise<string> {
  const slug = field(formData, "slug");
  await clearSession();
  return isSlug(slug) ? `/p/${slug}` : "/";
}

export async function saveUpdate(
  slug: string,
  input: PublishInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { pageId, member } = await readyMember(slug);
    if (!canPost(member.role)) throw new ActionError("You can't post on this page.");
    if (input.updateId) editUpdate(pageId, member, input.updateId, input);
    else publishUpdate(pageId, member, input);
    revalidatePath(`/p/${slug}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function markNoChange(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    quickCheckIn(pageId, member, "no_change");
  } catch (error) {
    if (error instanceof ActionError) redirect(pagePath(slug, error.message));
    throw error;
  }
  redirect(pagePath(slug));
}

export async function markStillInSurgery(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    quickCheckIn(pageId, member, "still_in_surgery");
  } catch (error) {
    if (error instanceof ActionError) redirect(pagePath(slug, error.message));
    throw error;
  }
  redirect(pagePath(slug));
}

export async function savePinnedNote(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    setPinnedNote(pageId, member, field(formData, "pinnedNote"));
  } catch (error) {
    if (error instanceof ActionError) redirect(pagePath(slug, error.message));
    throw error;
  }
  redirect(pagePath(slug));
}

export async function addPersonAction(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    if (!canManagePeople(member.role)) throw new ActionError("You can't add people.");
    addPerson(pageId, member, field(formData, "name"), field(formData, "phone"), field(formData, "role"));
  } catch (error) {
    if (error instanceof ActionError) redirect(peoplePath(slug, error.message));
    throw error;
  }
  redirect(peoplePath(slug));
}

export async function addPeopleAction(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    if (!canManagePeople(member.role)) throw new ActionError("You can't add people.");
    addPeople(pageId, member, field(formData, "list"), field(formData, "role"));
  } catch (error) {
    if (error instanceof ActionError) redirect(peoplePath(slug, error.message));
    throw error;
  }
  redirect(peoplePath(slug));
}

export async function removePersonAction(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    removePerson(pageId, member, field(formData, "memberId"));
  } catch (error) {
    if (error instanceof ActionError) redirect(peoplePath(slug, error.message));
    throw error;
  }
  redirect(peoplePath(slug));
}

export async function changeTierAction(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    changeTier(pageId, member, field(formData, "memberId"), field(formData, "role"));
  } catch (error) {
    if (error instanceof ActionError) redirect(peoplePath(slug, error.message));
    throw error;
  }
  redirect(peoplePath(slug));
}

export async function handOffAction(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    if (!allows(member, ["owner"])) throw new ActionError("Only the owner can hand this page off.");
    handOff(pageId, member, field(formData, "memberId"));
  } catch (error) {
    if (error instanceof ActionError) redirect(peoplePath(slug, error.message));
    throw error;
  }
  redirect(peoplePath(slug));
}

export async function setUpdateHidden(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  try {
    const { pageId, member } = await readyMember(slug);
    setHidden(pageId, member, field(formData, "updateId"), field(formData, "hidden") === "1");
  } catch (error) {
    if (error instanceof ActionError) redirect(historyPath(slug, error.message));
    throw error;
  }
  redirect(historyPath(slug));
}

export async function reactToUpdate(formData: FormData): Promise<void> {
  const slug = field(formData, "slug");
  const back = returnPath(slug, field(formData, "returnTo"));
  try {
    const { pageId, member } = await readyMember(slug);
    setReaction(pageId, member, field(formData, "updateId"), field(formData, "kind"));
    revalidatePath(`/p/${slug}`);
    revalidatePath(`/p/${slug}/history`);
  } catch (error) {
    if (error instanceof ActionError) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  redirect(back);
}
