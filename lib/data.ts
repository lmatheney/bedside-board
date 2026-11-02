import "server-only";
import { ActionError } from "@/lib/errors";
import { cleanName } from "@/lib/names";
import { normalizeEmail } from "@/lib/email";
import { presetById, presetLabel } from "@/lib/presets";
import { isReactionKind } from "@/lib/reactions";
import { canPost, canSeeInner, isStatus } from "@/lib/status";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import type {
  ActivityEntry,
  CarePage,
  CurrentMember,
  ListedMember,
  Notify,
  PublishInput,
  ReactionKind,
  Role,
  Status,
  UpdateReactions,
  VisibleUpdate,
} from "@/lib/types";

// Every read here runs as the signed-in person, so row-level security in
// the database decides what comes back. Every write is a database function
// that checks the caller's role again. The admin client is used only where
// noted.

type DbError = { code?: string; message: string } | null;

function sentence(message: string): string {
  const text = message.trim();
  if (!text) return "Something went wrong.";
  const capitalized = text[0]!.toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** Messages the database raises on purpose (P0001) are safe to show. */
function check(error: DbError): void {
  if (!error) return;
  if (error.code === "P0001") throw new ActionError(sentence(error.message));
  console.error("Supabase error", error);
  throw new Error("The database didn't respond. Try again.");
}

type PageRow = {
  id: string;
  slug: string;
  patient_first_name: string;
  current_status: string;
  show_critical_to_wider: boolean;
  last_updated_at: string | null;
  pinned_note: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  user_id: string;
  display_name: string;
  role: string;
  email: string;
  created_at: string;
};

type UpdateRow = {
  id: string;
  status: string;
  preset: string | null;
  wider_summary: string;
  show_critical_to_wider: boolean;
  notify: string;
  created_at: string;
  edited_at: string | null;
  hidden: boolean;
  created_by: string;
};

type DetailRow = { update_id: string; inner_note: string; latest_actions: unknown };

const PAGE_COLUMNS =
  "id, slug, patient_first_name, current_status, show_critical_to_wider, last_updated_at, pinned_note, created_at";
const UPDATE_COLUMNS =
  "id, status, preset, wider_summary, show_critical_to_wider, notify, created_at, edited_at, hidden, created_by";
const ROLE_ORDER: Record<Role, number> = { owner: 0, mod: 1, inner: 2, wider: 3 };

function asRole(value: string): Role {
  if (value === "owner" || value === "mod" || value === "inner" || value === "wider") return value;
  throw new ActionError("That role isn't valid.");
}

function asStatus(value: string): Status {
  if (!isStatus(value)) throw new ActionError("Choose a status.");
  return value;
}

function asNotify(value: string): Notify {
  if (value === "everyone" || value === "inner" || value === "none") return value;
  return "none";
}

function mapPage(row: PageRow): CarePage {
  return {
    id: row.id,
    slug: row.slug,
    patientFirstName: row.patient_first_name,
    currentStatus: asStatus(row.current_status),
    showCriticalToWider: row.show_critical_to_wider,
    lastUpdatedAt: row.last_updated_at,
    pinnedNote: row.pinned_note,
    createdAt: row.created_at,
  };
}

function mapMember(row: MemberRow): ListedMember {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    role: asRole(row.role),
    email: row.email,
    createdAt: row.created_at,
  };
}

function parseStoredActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** First name plus last initial, from the database. "Former follower" if they've left. */
async function namesFor(pageId: string, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("page_names", { p_page: pageId, p_users: unique });
  check(error);
  return new Map(((data ?? []) as { user_id: string; name: string }[]).map((row) => [row.user_id, row.name] as const));
}

async function queryUpdates(pageId: string, includeHidden: boolean, limit?: number): Promise<UpdateRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("updates")
    .select(UPDATE_COLUMNS)
    .eq("page_id", pageId)
    .in("hidden", includeHidden ? [true, false] : [false])
    .order("created_at", { ascending: false })
    .limit(limit ?? 1000);
  check(error);
  return (data ?? []) as UpdateRow[];
}

async function detailsFor(updateIds: string[]): Promise<Map<string, DetailRow>> {
  if (updateIds.length === 0) return new Map();
  const supabase = await createServerSupabase();
  // Row-level security returns nothing here for the wider circle.
  const { data, error } = await supabase
    .from("update_details")
    .select("update_id, inner_note, latest_actions")
    .in("update_id", updateIds);
  check(error);
  return new Map(((data ?? []) as DetailRow[]).map((row) => [row.update_id, row] as const));
}

async function hydrate(pageId: string, rows: UpdateRow[], withDetails: boolean): Promise<VisibleUpdate[]> {
  if (rows.length === 0) return [];
  const [names, details] = await Promise.all([
    namesFor(
      pageId,
      rows.map((row) => row.created_by),
    ),
    withDetails
      ? detailsFor(rows.map((row) => row.id))
      : Promise.resolve(null as Map<string, DetailRow> | null),
  ]);
  return rows.map((row) => {
    const detail = details?.get(row.id);
    return {
      id: row.id,
      status: asStatus(row.status),
      preset: row.preset,
      widerSummary: row.wider_summary,
      showCriticalToWider: row.show_critical_to_wider,
      notify: asNotify(row.notify),
      createdAt: row.created_at,
      editedAt: row.edited_at,
      hidden: row.hidden,
      authorName: names.get(row.created_by) ?? "Care team",
      // Null means this viewer never asked for, and was never sent, the inner note.
      innerNote: details ? (detail?.inner_note ?? "") : null,
      latestActions: details ? parseStoredActions(detail?.latest_actions) : null,
    };
  });
}

async function updatesFor(pageId: string, role: Role, includeHidden: boolean, limit?: number): Promise<VisibleUpdate[]> {
  if (!canSeeInner(role)) return hydrate(pageId, await queryUpdates(pageId, false, limit), false);
  return hydrate(pageId, await queryUpdates(pageId, includeHidden, limit), true);
}

function assertCanAdd(actorRole: Role, role: Role): void {
  if (actorRole === "owner" && (role === "mod" || role === "inner" || role === "wider")) return;
  if (actorRole === "mod" && (role === "inner" || role === "wider")) return;
  throw new ActionError(actorRole === "mod" && role === "mod" ? "Only the owner can add a mod." : "You can't add that person.");
}

function hasBlank(text: string): boolean {
  return /\[[^\]\n]+\]/.test(text);
}

function parseActions(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 8) throw new ActionError("Keep latest actions to 8 lines.");
  for (const line of lines) {
    if (line.length > 140) throw new ActionError("Each latest-action line needs to be under 140 characters.");
  }
  return lines;
}

function cleanPost(input: PublishInput) {
  const preset = presetById(input.preset);
  if (!preset) throw new ActionError("Choose a preset.");
  const status = asStatus(input.status);
  const inner = input.innerNote.trim();
  const wider = input.widerSummary.trim();
  if (!inner) throw new ActionError("Write what the inner circle should see.");
  if (preset.id !== "freeform" && !wider) throw new ActionError("Write the wider-circle summary.");
  if (inner.length > 2000 || wider.length > 2000) throw new ActionError("That update is too long.");
  if (preset.id !== "freeform" && (hasBlank(inner) || hasBlank(wider))) {
    throw new ActionError("Replace the blanks in square brackets before posting.");
  }
  const notify = input.notify;
  if (notify !== "everyone" && notify !== "inner" && notify !== "none") {
    throw new ActionError("Choose who should be texted.");
  }
  return {
    preset,
    status,
    inner,
    wider,
    actions: parseActions(input.latestActions),
    notify,
    showCritical: status === "critical" && input.showCriticalToWider,
  };
}

function requirePerson(rawName: string, rawEmail: string): { name: string; email: string } {
  const name = cleanName(rawName);
  const email = normalizeEmail(rawEmail);
  if (!name) throw new ActionError("Enter a name.");
  if (!email) throw new ActionError("Enter a valid email address.");
  return { name, email };
}

function parsePeopleList(text: string): { name: string; email: string }[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new ActionError("Add at least one name and email.");
  if (lines.length > 40) throw new ActionError("Add up to 40 people at a time.");
  const people: { name: string; email: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let nameRaw = "";
    let emailRaw = "";
    const parts = line.split(/[,\t|]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      emailRaw = parts[parts.length - 1] ?? "";
      nameRaw = parts.slice(0, -1).join(" ");
    } else {
      // "Sam Rivera sam@example.com", with no separator.
      const match = line.match(/^(.*?)\s*(<?[^\s<>@]+@[^\s<>@]+>?)\s*$/);
      if (match) {
        nameRaw = match[1]?.trim() ?? "";
        emailRaw = (match[2] ?? "").replace(/^<|>$/g, "");
      }
    }
    const name = cleanName(nameRaw);
    const email = normalizeEmail(emailRaw);
    if (!name || !email) {
      throw new ActionError(`Couldn't read "${line.slice(0, 80)}". Use one person per line: Name, email`);
    }
    if (seen.has(email)) throw new ActionError(`${name} is listed twice.`);
    seen.add(email);
    people.push({ name, email });
  }
  return people;
}

async function listedMember(pageId: string, memberId: string): Promise<ListedMember> {
  const found = (await listMembers(pageId)).find((person) => person.id === memberId);
  if (!found) throw new ActionError("That person isn't on this page.");
  return found;
}

// ---------------------------------------------------------------------------
// Pages and people
// ---------------------------------------------------------------------------

/** The signed-in person becomes the owner. Sign in first. */
export async function createPage(input: { patientFirstName: string; ownerName: string }): Promise<{ slug: string }> {
  const patient = cleanName(input.patientFirstName);
  const owner = cleanName(input.ownerName);
  if (!patient) throw new ActionError("Enter the patient's first name.");
  if (!owner) throw new ActionError("Enter your name.");
  const supabase = await createServerSupabase();
  const created = await supabase.rpc("create_care_page", { p_patient_first_name: patient, p_display_name: owner });
  check(created.error);
  const { data, error } = await supabase.from("care_pages").select("slug").eq("id", created.data).single();
  check(error);
  return { slug: (data as { slug: string }).slug };
}

/**
 * Does this page exist? Used before anyone has signed in, when row-level
 * security would (correctly) hide every page. Returns only the id.
 */
export async function pageIdForSlug(slug: string): Promise<string | null> {
  const { data, error } = await createAdminSupabase()
    .from("care_pages")
    .select("id")
    .eq("slug", slug)
    .is("closed_at", null)
    .maybeSingle();
  check(error);
  return (data as { id: string } | null)?.id ?? null;
}

/** The page, if the signed-in person is on it. */
export async function getPageBySlug(slug: string): Promise<CarePage | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("care_pages").select(PAGE_COLUMNS).eq("slug", slug).maybeSingle();
  check(error);
  return data ? mapPage(data as PageRow) : null;
}

export async function getMember(pageId: string, userId: string): Promise<CurrentMember | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("members")
    .select("id, user_id, display_name, role")
    .eq("page_id", pageId)
    .eq("user_id", userId)
    .maybeSingle();
  check(error);
  if (!data) return null;
  const row = data as { id: string; user_id: string; display_name: string; role: string };
  return { id: row.id, userId: row.user_id, displayName: row.display_name, role: asRole(row.role) };
}

/** Owner and mods only. The database returns nothing to anyone else. */
export async function listMembers(pageId: string): Promise<ListedMember[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("list_members", { p_page: pageId });
  check(error);
  return ((data ?? []) as MemberRow[])
    .map(mapMember)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Reading updates
// ---------------------------------------------------------------------------

export async function latestUpdate(pageId: string, role: Role): Promise<VisibleUpdate | null> {
  return (await updatesFor(pageId, role, false, 1))[0] ?? null;
}

export async function listUpdates(pageId: string, role: Role, includeHidden: boolean): Promise<VisibleUpdate[]> {
  return updatesFor(pageId, role, includeHidden && canPost(role));
}

export async function newestUpdateIsHidden(pageId: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("updates")
    .select("hidden")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  check(error);
  return (data as { hidden: boolean } | null)?.hidden === true;
}

export async function getEditableUpdate(pageId: string, updateId: string): Promise<VisibleUpdate | null> {
  if (!isUuid(updateId)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("updates")
    .select(UPDATE_COLUMNS)
    .eq("page_id", pageId)
    .eq("id", updateId)
    .maybeSingle();
  check(error);
  if (!data) return null;
  return (await hydrate(pageId, [data as UpdateRow], true))[0] ?? null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function reactionsFor(
  pageId: string,
  updateIds: string[],
  viewerId: string,
): Promise<Map<string, UpdateReactions>> {
  const map = new Map<string, UpdateReactions>();
  for (const id of updateIds) map.set(id, { groups: [], mine: null });
  if (updateIds.length === 0) return map;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("reactions")
    .select("update_id, user_id, kind")
    .in("update_id", updateIds)
    .order("created_at", { ascending: true });
  check(error);
  const rows = (data ?? []) as { update_id: string; user_id: string; kind: string }[];
  const names = await namesFor(
    pageId,
    rows.map((row) => row.user_id),
  );
  const grouped = new Map<string, Map<ReactionKind, string[]>>();
  for (const row of rows) {
    if (!isReactionKind(row.kind)) continue;
    const bucket = grouped.get(row.update_id) ?? new Map<ReactionKind, string[]>();
    const list = bucket.get(row.kind) ?? [];
    list.push(names.get(row.user_id) ?? "Former follower");
    bucket.set(row.kind, list);
    grouped.set(row.update_id, bucket);
    if (row.user_id === viewerId) {
      const current = map.get(row.update_id) ?? { groups: [], mine: null };
      current.mine = row.kind;
      map.set(row.update_id, current);
    }
  }
  const order: ReactionKind[] = ["love", "praying", "strength", "great_news", "hugs"];
  for (const [updateId, bucket] of grouped) {
    const current = map.get(updateId) ?? { groups: [], mine: null };
    current.groups = order
      .filter((kind) => bucket.has(kind))
      .map((kind) => {
        const list = bucket.get(kind) ?? [];
        return { kind, count: list.length, names: list };
      });
    map.set(updateId, current);
  }
  return map;
}

const PRESET_ACTIONS = new Set(["posted an update", "edited an update", "hid an update", "put an update back"]);

/** Owner only. The database returns nothing to anyone else. */
export async function listActivity(pageId: string): Promise<ActivityEntry[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, actor_name, action, target, at")
    .eq("page_id", pageId)
    .order("at", { ascending: false })
    .limit(80);
  check(error);
  return ((data ?? []) as { id: string; actor_name: string; action: string; target: string | null; at: string }[]).map(
    (entry) => ({
      id: entry.id,
      actorName: entry.actor_name,
      action: entry.action,
      target: PRESET_ACTIONS.has(entry.action) ? (presetLabel(entry.target) ?? entry.target) : entry.target,
      at: entry.at,
    }),
  );
}

// ---------------------------------------------------------------------------
// Sign-in. Supabase Auth emails a one-time link. The link lands on
// /auth/callback, which trades the link's code for a session.
// ---------------------------------------------------------------------------

async function sendLink(email: string, redirectTo: string): Promise<void> {
  const supabase = await createServerSupabase();
  // Never creates an account: Supabase only emails addresses that already have one.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  if (!error) return;
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    throw new ActionError("Wait a minute before asking for another link.");
  }
  console.error("Could not send sign-in link", error);
  throw new ActionError("We couldn't send the email. Try again in a minute.");
}

/** Only addresses already on the page get a link. Nothing is sent to anyone else. */
export async function requestLoginLink(pageId: string, rawEmail: string, redirectTo: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new ActionError("Enter a valid email address.");
  const { data, error } = await createAdminSupabase().rpc("page_member_for_email", { p_page: pageId, p_email: email });
  check(error);
  if (!data) throw new ActionError("That email isn't on this page. Ask a caregiver to add you.");
  await sendLink(email, redirectTo);
}

/**
 * Sign-ups are off in Supabase, so starting a page makes the owner's account
 * here (the caller has already checked the setup code) and then emails the link.
 */
export async function requestOwnerLink(rawEmail: string, redirectTo: string): Promise<string> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new ActionError("Enter a valid email address.");
  await ensureAccounts([{ name: "the owner", email }]);
  await sendLink(email, redirectTo);
  return email;
}

/**
 * Trades the code from the emailed link for a session. This only works in
 * the browser that asked for the link, which is what keeps a forwarded or
 * pre-scanned link from signing anyone in.
 */
export async function exchangeLinkCode(code: string): Promise<{ userId: string; email: string | null }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    throw new ActionError(
      "That link didn't work. It may have expired, or been opened in a different browser. Ask for a new one.",
    );
  }
  return { userId: data.user.id, email: data.user.email ?? null };
}

/** After the link is used: only people on this page stay signed in. */
export async function finishLogin(pageId: string, userId: string): Promise<void> {
  if (await getMember(pageId, userId)) return;
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  throw new ActionError("You don't have access to this page.");
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function publishUpdate(pageId: string, actor: CurrentMember, input: PublishInput): Promise<void> {
  if (!canPost(actor.role)) throw new ActionError("You can't post on this page.");
  const post = cleanPost(input);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("publish_update", {
    p_page: pageId,
    p_status: post.status,
    p_preset: post.preset.id,
    p_wider_summary: post.wider,
    p_inner_note: post.inner,
    p_latest_actions: post.actions,
    p_notify: post.notify,
    p_show_critical: post.showCritical,
  });
  check(error);
}

async function requireUpdateOnPage(pageId: string, updateId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { data, error } = isUuid(updateId)
    ? await supabase.from("updates").select("id").eq("id", updateId).eq("page_id", pageId).maybeSingle()
    : { data: null, error: null };
  check(error);
  if (!data) throw new ActionError("That update isn't on this page.");
}

export async function editUpdate(pageId: string, actor: CurrentMember, updateId: string, input: PublishInput): Promise<void> {
  if (!canPost(actor.role)) throw new ActionError("You can't post on this page.");
  await requireUpdateOnPage(pageId, updateId);
  // Editing never changes who gets texted, so the choice is ignored here.
  const post = cleanPost({ ...input, notify: "none" });
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("edit_update", {
    p_update: updateId,
    p_status: post.status,
    p_preset: post.preset.id,
    p_wider_summary: post.wider,
    p_inner_note: post.inner,
    p_latest_actions: post.actions,
    p_show_critical: post.showCritical,
  });
  check(error);
}

export async function setHidden(pageId: string, actor: CurrentMember, updateId: string, hidden: boolean): Promise<void> {
  if (!canPost(actor.role)) throw new ActionError("You can't change updates.");
  await requireUpdateOnPage(pageId, updateId);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_update_hidden", { p_update: updateId, p_hidden: hidden });
  check(error);
}

export async function quickCheckIn(pageId: string, actor: CurrentMember, kind: "no_change" | "still_in_surgery"): Promise<void> {
  if (!canPost(actor.role)) throw new ActionError("You can't post on this page.");
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("quick_check_in", { p_page: pageId, p_kind: kind });
  check(error);
}

export async function setPinnedNote(pageId: string, actor: CurrentMember, raw: string): Promise<void> {
  if (!canPost(actor.role)) throw new ActionError("You can't change the note.");
  const note = raw.trim();
  if (note.length > 280) throw new ActionError("Keep the pinned note under 280 characters.");
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_pinned_note", { p_page: pageId, p_note: note });
  check(error);
}

export async function setReaction(pageId: string, _actor: CurrentMember, updateId: string, kind: string): Promise<void> {
  if (!isReactionKind(kind)) throw new ActionError("Choose a reaction.");
  await requireUpdateOnPage(pageId, updateId);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_reaction", { p_update: updateId, p_kind: kind });
  check(error);
}

/**
 * Followers don't have accounts until a mod adds them, so each email gets
 * a sign-in account here. It is already confirmed: the code emailed at
 * sign-in is what proves they own the address.
 */
async function ensureAccounts(people: { name: string; email: string }[]): Promise<{ user_id: string; name: string }[]> {
  const admin = createAdminSupabase();
  const found: { user_id: string; name: string }[] = [];
  for (const person of people) {
    let userId = await lookupAccount(person.email);
    if (!userId) {
      const created = await admin.auth.admin.createUser({ email: person.email, email_confirm: true });
      if (created.error) {
        // Someone else may have just created it.
        userId = await lookupAccount(person.email);
        if (!userId) {
          console.error("Could not create account", created.error);
          throw new ActionError(`Couldn't add ${person.name}. Check the email address and try again.`);
        }
      } else {
        userId = created.data.user.id;
      }
    }
    found.push({ user_id: userId, name: person.name });
  }
  return found;
}

async function lookupAccount(email: string): Promise<string | null> {
  const { data, error } = await createAdminSupabase().rpc("auth_user_id_for_email", { p_email: email });
  check(error);
  return (data as string | null) ?? null;
}

async function addToPage(pageId: string, people: { name: string; email: string }[], role: Role): Promise<void> {
  const accounts = await ensureAccounts(people);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("add_members", { p_page: pageId, p_people: accounts, p_role: role });
  check(error);
}

export async function addPerson(pageId: string, actor: CurrentMember, rawName: string, rawEmail: string, role: string): Promise<void> {
  const next = asRole(role);
  assertCanAdd(actor.role, next);
  const person = requirePerson(rawName, rawEmail);
  await addToPage(pageId, [person], next);
}

export async function addPeople(pageId: string, actor: CurrentMember, rawList: string, role: string): Promise<void> {
  const next = asRole(role);
  assertCanAdd(actor.role, next);
  await addToPage(pageId, parsePeopleList(rawList), next);
}

export async function removePerson(pageId: string, actor: CurrentMember, memberId: string): Promise<void> {
  if (actor.role !== "owner" && actor.role !== "mod") throw new ActionError("You can't remove people.");
  const target = await listedMember(pageId, memberId);
  if (target.role === "owner") throw new ActionError("The owner stays on the page.");
  if (actor.role === "mod" && target.role === "mod") throw new ActionError("Only the owner can remove a mod.");
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("remove_member", { p_page: pageId, p_member: target.id });
  check(error);
  // Access already ended above. This also ends their sign-ins if they are on no other page.
  const revoked = await createAdminSupabase().rpc("revoke_sessions_if_orphaned", { p_user: target.userId });
  if (revoked.error) console.error("Could not revoke sessions", revoked.error);
}

export async function changeTier(pageId: string, actor: CurrentMember, memberId: string, role: string): Promise<void> {
  const next = asRole(role);
  const target = await listedMember(pageId, memberId);
  if (target.role === "owner" || next === "owner") {
    throw new ActionError("Hand ownership to a mod instead of changing it here.");
  }
  if (actor.role === "owner") {
    if (next !== "mod" && next !== "inner" && next !== "wider") throw new ActionError("Choose a tier.");
  } else if (actor.role === "mod") {
    if (target.role === "mod") throw new ActionError("Only the owner can change a mod.");
    if (next === "mod") throw new ActionError("Only the owner can add a mod.");
    if (next !== "inner" && next !== "wider") throw new ActionError("Choose a tier.");
  } else {
    throw new ActionError("You can't change that.");
  }
  if (target.role === next) return;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_member_role", { p_page: pageId, p_member: target.id, p_role: next });
  check(error);
}

export async function handOff(pageId: string, actor: CurrentMember, memberId: string): Promise<void> {
  if (actor.role !== "owner") throw new ActionError("Only the owner can hand this page off.");
  const target = await listedMember(pageId, memberId);
  if (target.role !== "mod") throw new ActionError("Choose a mod to become the owner.");
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("hand_off_ownership", { p_page: pageId, p_member: target.id });
  check(error);
}
