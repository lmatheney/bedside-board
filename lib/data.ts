import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { many, one, run, withTx } from "@/lib/db";
import { ActionError } from "@/lib/errors";
import { hashesMatch, sha256 } from "@/lib/hash";
import { cleanName, publicName } from "@/lib/names";
import { normalizePhone } from "@/lib/phone";
import { presetById, presetLabel } from "@/lib/presets";
import { isReactionKind, ROLE_LABEL } from "@/lib/reactions";
import { newSlug } from "@/lib/slug";
import { canPost, canSeeInner, isStatus } from "@/lib/status";
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

const MEMBER_CAP = 300;

type PageRow = {
  id: string;
  slug: string;
  patient_first_name: string;
  current_status: string;
  show_critical_to_wider: number;
  last_updated_at: string | null;
  pinned_note: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  user_id: string;
  display_name: string;
  role: string;
  phone: string;
  created_at: string;
};

type UpdateRow = {
  id: string;
  status: string;
  preset: string | null;
  wider_summary: string;
  show_critical_to_wider: number;
  notify: string;
  created_at: string;
  edited_at: string | null;
  hidden: number;
  author_name: string | null;
};

const UPDATE_COLUMNS = `
  u.id, u.status, u.preset, u.wider_summary, u.show_critical_to_wider,
  u.notify, u.created_at, u.edited_at, u.hidden, m.display_name as author_name
`;

function nowIso(): string {
  return new Date().toISOString();
}

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
    showCriticalToWider: row.show_critical_to_wider === 1,
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
    phone: row.phone,
    createdAt: row.created_at,
  };
}

function baseUpdate(row: UpdateRow): Omit<VisibleUpdate, "innerNote" | "latestActions"> {
  return {
    id: row.id,
    status: asStatus(row.status),
    preset: row.preset,
    widerSummary: row.wider_summary,
    showCriticalToWider: row.show_critical_to_wider === 1,
    notify: asNotify(row.notify),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    hidden: row.hidden === 1,
    authorName: row.author_name ? publicName(row.author_name) : "Care team",
  };
}

function parseStoredActions(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function queryUpdates(pageId: string, includeHidden: boolean, limit = -1): UpdateRow[] {
  return many<UpdateRow>(
    `select ${UPDATE_COLUMNS}
     from updates u
     left join members m on m.page_id = u.page_id and m.user_id = u.created_by
     where u.page_id = ? and (? = 1 or u.hidden = 0)
     order by u.created_at desc
     limit ?`,
    pageId,
    includeHidden ? 1 : 0,
    limit,
  );
}

function attachDetails(rows: UpdateRow[]): VisibleUpdate[] {
  if (rows.length === 0) return [];
  const details = many<{ update_id: string; inner_note: string; latest_actions: string }>(
    `select update_id, inner_note, latest_actions from update_details where update_id in (${rows.map(() => "?").join(",")})`,
    ...rows.map((row) => row.id),
  );
  const byId = new Map(details.map((detail) => [detail.update_id, detail]));
  return rows.map((row) => {
    const detail = byId.get(row.id);
    return {
      ...baseUpdate(row),
      innerNote: detail?.inner_note ?? "",
      latestActions: parseStoredActions(detail?.latest_actions ?? "[]"),
    };
  });
}

function withoutDetails(rows: UpdateRow[]): VisibleUpdate[] {
  const updates = rows.map((row) => ({ ...baseUpdate(row), innerNote: null, latestActions: null }));
  if (process.env.NODE_ENV !== "production") {
    for (const update of updates) {
      if (update.innerNote !== null || update.latestActions !== null) {
        throw new Error("Wider-circle read included inner-circle detail.");
      }
    }
  }
  return updates;
}

function updatesFor(pageId: string, role: Role, includeHidden: boolean, limit = -1): VisibleUpdate[] {
  if (!canSeeInner(role)) return withoutDetails(queryUpdates(pageId, false, limit));
  return attachDetails(queryUpdates(pageId, includeHidden, limit));
}

function log(pageId: string, actorId: string, actorName: string, action: string, target: string | null): void {
  run(
    `insert into activity_log (id, page_id, actor_id, actor_name, action, target, at) values (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    pageId,
    actorId,
    actorName,
    action,
    target,
    nowIso(),
  );
}

function devCodesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.BEDSIDE_DEV_CODES === "1";
}

function assertCanAdd(actorRole: Role, role: Role): void {
  if (actorRole === "owner" && (role === "mod" || role === "inner" || role === "wider")) return;
  if (actorRole === "mod" && (role === "inner" || role === "wider")) return;
  throw new ActionError(actorRole === "mod" && role === "mod" ? "Only the owner can add a mod." : "You can't add that person.");
}

function memberCount(pageId: string): number {
  return Number(one<{ n: number | bigint }>(`select count(*) as n from members where page_id = ?`, pageId)?.n ?? 0);
}

function insertMember(pageId: string, person: { name: string; phone: string; role: Role }, addedBy: string): void {
  const existingUser = one<{ id: string }>(`select id from users where phone = ?`, person.phone);
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    const already = one<{ display_name: string }>(
      `select display_name from members where page_id = ? and user_id = ?`,
      pageId,
      userId,
    );
    if (already) throw new ActionError(`${already.display_name} is already on this page.`);
  } else {
    userId = randomUUID();
    run(`insert into users (id, phone, created_at) values (?, ?, ?)`, userId, person.phone, nowIso());
  }
  run(
    `insert into members (id, page_id, user_id, display_name, role, texts_muted, added_by, created_at) values (?, ?, ?, ?, ?, 0, ?, ?)`,
    randomUUID(),
    pageId,
    userId,
    person.name,
    person.role,
    addedBy,
    nowIso(),
  );
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

function requirePerson(rawName: string, rawPhone: string): { name: string; phone: string } {
  const name = cleanName(rawName);
  const phone = normalizePhone(rawPhone);
  if (!name) throw new ActionError("Enter a name.");
  if (!phone) throw new ActionError("Enter a US mobile number.");
  return { name, phone };
}

function parsePeopleList(text: string): { name: string; phone: string }[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new ActionError("Add at least one name and number.");
  if (lines.length > 40) throw new ActionError("Add up to 40 people at a time.");
  const people: { name: string; phone: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let nameRaw = "";
    let phoneRaw = "";
    const parts = line.split(/[,\t|]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      phoneRaw = parts[parts.length - 1] ?? "";
      nameRaw = parts.slice(0, -1).join(" ");
    } else {
      const match = line.match(/^(.*?)(\+?\d[\d\s().-]{8,}\d)\s*$/);
      if (match) {
        nameRaw = match[1]?.trim() ?? "";
        phoneRaw = match[2] ?? "";
      }
    }
    const name = cleanName(nameRaw);
    const phone = normalizePhone(phoneRaw);
    if (!name || !phone) {
      throw new ActionError(`Couldn't read "${line.slice(0, 80)}". Use one person per line: Name, phone`);
    }
    if (seen.has(phone)) throw new ActionError(`${name} is listed twice.`);
    seen.add(phone);
    people.push({ name, phone });
  }
  return people;
}

function listedMember(pageId: string, memberId: string): ListedMember {
  const row = one<MemberRow>(
    `select m.id, m.user_id, m.display_name, m.role, m.created_at, u.phone
     from members m join users u on u.id = m.user_id
     where m.id = ? and m.page_id = ?`,
    memberId,
    pageId,
  );
  if (!row) throw new ActionError("That person isn't on this page.");
  return mapMember(row);
}

export function createPage(input: { patientFirstName: string; ownerName: string; phone: string }): { slug: string; userId: string } {
  const patient = cleanName(input.patientFirstName);
  const owner = cleanName(input.ownerName);
  const phone = normalizePhone(input.phone);
  if (!patient) throw new ActionError("Enter the patient's first name.");
  if (!owner) throw new ActionError("Enter your name.");
  if (!phone) throw new ActionError("Enter a US mobile number.");
  const slug = newSlug();
  const pageId = randomUUID();
  let userId = "";
  withTx(() => {
    const existing = one<{ id: string }>(`select id from users where phone = ?`, phone);
    userId = existing?.id ?? randomUUID();
    if (!existing) run(`insert into users (id, phone, created_at) values (?, ?, ?)`, userId, phone, nowIso());
    run(
      `insert into care_pages (id, slug, patient_first_name, current_status, show_critical_to_wider, pinned_note, created_at)
       values (?, ?, ?, 'stable', 0, '', ?)`,
      pageId,
      slug,
      patient,
      nowIso(),
    );
    run(
      `insert into members (id, page_id, user_id, display_name, role, texts_muted, added_by, created_at)
       values (?, ?, ?, ?, 'owner', 0, ?, ?)`,
      randomUUID(),
      pageId,
      userId,
      owner,
      userId,
      nowIso(),
    );
    log(pageId, userId, owner, "started this page", patient);
  });
  return { slug, userId };
}

export function getPageBySlug(slug: string): CarePage | null {
  const row = one<PageRow>(
    `select id, slug, patient_first_name, current_status, show_critical_to_wider, last_updated_at, pinned_note, created_at
     from care_pages where slug = ? and closed_at is null`,
    slug,
  );
  return row ? mapPage(row) : null;
}

export function getMember(pageId: string, userId: string): CurrentMember | null {
  const row = one<{ id: string; user_id: string; display_name: string; role: string }>(
    `select id, user_id, display_name, role from members where page_id = ? and user_id = ?`,
    pageId,
    userId,
  );
  if (!row) return null;
  return { id: row.id, userId: row.user_id, displayName: row.display_name, role: asRole(row.role) };
}

export function listMembers(pageId: string): ListedMember[] {
  return many<MemberRow>(
    `select m.id, m.user_id, m.display_name, m.role, m.created_at, u.phone
     from members m join users u on u.id = m.user_id
     where m.page_id = ?
     order by case m.role when 'owner' then 0 when 'mod' then 1 when 'inner' then 2 else 3 end, m.created_at asc`,
    pageId,
  ).map(mapMember);
}

export function latestUpdate(pageId: string, role: Role): VisibleUpdate | null {
  return updatesFor(pageId, role, false, 1)[0] ?? null;
}

export function listUpdates(pageId: string, role: Role, includeHidden: boolean): VisibleUpdate[] {
  return updatesFor(pageId, role, includeHidden && canPost(role));
}

export function newestUpdateIsHidden(pageId: string): boolean {
  const row = one<{ hidden: number }>(
    `select hidden from updates where page_id = ? order by created_at desc limit 1`,
    pageId,
  );
  return row?.hidden === 1;
}

export function getEditableUpdate(pageId: string, updateId: string): VisibleUpdate | null {
  const rows = many<UpdateRow>(
    `select ${UPDATE_COLUMNS}
     from updates u
     left join members m on m.page_id = u.page_id and m.user_id = u.created_by
     where u.page_id = ? and u.id = ?`,
    pageId,
    updateId,
  );
  return attachDetails(rows)[0] ?? null;
}

export function reactionsFor(pageId: string, updateIds: string[], viewerId: string): Map<string, UpdateReactions> {
  const map = new Map<string, UpdateReactions>();
  for (const id of updateIds) map.set(id, { groups: [], mine: null });
  if (updateIds.length === 0) return map;
  const rows = many<{ update_id: string; user_id: string; kind: string; display_name: string | null }>(
    `select r.update_id, r.user_id, r.kind, m.display_name
     from reactions r
     join updates u on u.id = r.update_id
     left join members m on m.page_id = u.page_id and m.user_id = r.user_id
     where u.page_id = ? and r.update_id in (${updateIds.map(() => "?").join(",")})
     order by r.created_at asc`,
    pageId,
    ...updateIds,
  );
  const grouped = new Map<string, Map<ReactionKind, string[]>>();
  for (const row of rows) {
    if (!isReactionKind(row.kind)) continue;
    const bucket = grouped.get(row.update_id) ?? new Map<ReactionKind, string[]>();
    const names = bucket.get(row.kind) ?? [];
    names.push(row.display_name ? publicName(row.display_name) : "Former follower");
    bucket.set(row.kind, names);
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
        const names = bucket.get(kind) ?? [];
        return { kind, count: names.length, names };
      });
    map.set(updateId, current);
  }
  return map;
}

export function listActivity(pageId: string): ActivityEntry[] {
  return many<{ id: string; actor_name: string; action: string; target: string | null; at: string }>(
    `select id, actor_name, action, target, at from activity_log where page_id = ? order by at desc limit 80`,
    pageId,
  ).map((entry) => ({
    id: entry.id,
    actorName: entry.actor_name,
    action: entry.action,
    target: entry.target,
    at: entry.at,
  }));
}

export function requestLoginCode(pageId: string, rawPhone: string): { devCode?: string } {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new ActionError("Enter a US mobile number.");
  const member = one<{ id: string }>(
    `select m.id from members m join users u on u.id = m.user_id where m.page_id = ? and u.phone = ?`,
    pageId,
    phone,
  );
  if (!member) throw new ActionError("That number isn't on this page. Ask a caregiver to add you.");
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = Number(
    one<{ n: number | bigint }>(
      `select count(*) as n from login_codes where page_id = ? and phone = ? and created_at > ?`,
      pageId,
      phone,
      since,
    )?.n ?? 0,
  );
  if (recent >= 5) throw new ActionError("Wait a few minutes and try again.");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const now = nowIso();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  withTx(() => {
    run(`delete from login_codes where created_at < ?`, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    run(`update login_codes set invalidated = 1 where page_id = ? and phone = ? and invalidated = 0`, pageId, phone);
    run(
      `insert into login_codes (id, page_id, phone, code_hash, created_at, expires_at, attempts, invalidated) values (?, ?, ?, ?, ?, ?, 0, 0)`,
      randomUUID(),
      pageId,
      phone,
      sha256(`${phone}:${code}`),
      now,
      expires,
    );
  });
  return devCodesEnabled() ? { devCode: code } : {};
}

export function verifyLoginCode(pageId: string, rawPhone: string, rawCode: string): string {
  const phone = normalizePhone(rawPhone);
  const code = rawCode.trim();
  if (!phone) throw new ActionError("Enter a US mobile number.");
  if (!/^\d{6}$/.test(code)) throw new ActionError("Enter the 6-digit code.");
  const row = one<{ id: string; code_hash: string; expires_at: string; attempts: number }>(
    `select id, code_hash, expires_at, attempts from login_codes
     where page_id = ? and phone = ? and invalidated = 0
     order by created_at desc limit 1`,
    pageId,
    phone,
  );
  const dummy = sha256("missing");
  const presented = sha256(`${phone}:${code}`);
  const matched = hashesMatch(row?.code_hash ?? dummy, row ? presented : dummy);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new ActionError("That code expired. Request a new one.");
  }
  if (row.attempts >= 5) throw new ActionError("Too many tries. Request a new code.");
  run(`update login_codes set attempts = attempts + 1 where id = ?`, row.id);
  if (!matched) throw new ActionError("That code doesn't match. Try again.");
  const member = one<{ user_id: string }>(
    `select m.user_id from members m join users u on u.id = m.user_id where m.page_id = ? and u.phone = ?`,
    pageId,
    phone,
  );
  if (!member) throw new ActionError("You don't have access to this page.");
  run(`update login_codes set invalidated = 1 where id = ?`, row.id);
  return member.user_id;
}

export function publishUpdate(pageId: string, actor: CurrentMember, input: PublishInput): void {
  if (!canPost(actor.role)) throw new ActionError("You can't post on this page.");
  const post = cleanPost(input);
  const id = randomUUID();
  const now = nowIso();
  withTx(() => {
    run(
      `insert into updates (id, page_id, status, preset, wider_summary, show_critical_to_wider, notify, created_by, created_at, hidden)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      id,
      pageId,
      post.status,
      post.preset.id,
      post.wider,
      post.showCritical ? 1 : 0,
      post.notify,
      actor.userId,
      now,
    );
    run(
      `insert into update_details (update_id, inner_note, latest_actions) values (?, ?, ?)`,
      id,
      post.inner,
      JSON.stringify(post.actions),
    );
    run(
      `update care_pages set current_status = ?, show_critical_to_wider = ?, last_updated_at = ? where id = ?`,
      post.status,
      post.showCritical ? 1 : 0,
      now,
      pageId,
    );
    log(pageId, actor.userId, actor.displayName, "posted an update", post.preset.label);
  });
}

export function editUpdate(pageId: string, actor: CurrentMember, updateId: string, input: PublishInput): void {
  if (!canPost(actor.role)) throw new ActionError("You can't post on this page.");
  const existing = one<{ id: string; status: string; show_critical_to_wider: number; created_at: string; notify: string }>(
    `select id, status, show_critical_to_wider, created_at, notify from updates where id = ? and page_id = ?`,
    updateId,
    pageId,
  );
  if (!existing) throw new ActionError("That update isn't on this page.");
  const post = cleanPost({ ...input, notify: asNotify(existing.notify) });
  const now = nowIso();
  const late = Date.now() - new Date(existing.created_at).getTime() > 10 * 60 * 1000;
  const statusChanged = existing.status !== post.status || (existing.show_critical_to_wider === 1) !== post.showCritical;
  const latest = one<{ id: string }>(
    `select id from updates where page_id = ? and hidden = 0 order by created_at desc limit 1`,
    pageId,
  );
  const isLatest = latest?.id === updateId;
  withTx(() => {
    run(
      `update updates set status = ?, preset = ?, wider_summary = ?, show_critical_to_wider = ?, edited_at = ? where id = ?`,
      post.status,
      post.preset.id,
      post.wider,
      post.showCritical ? 1 : 0,
      now,
      updateId,
    );
    run(
      `update update_details set inner_note = ?, latest_actions = ? where update_id = ?`,
      post.inner,
      JSON.stringify(post.actions),
      updateId,
    );
    if (isLatest) {
      run(
        `update care_pages set current_status = ?, show_critical_to_wider = ? where id = ?`,
        post.status,
        post.showCritical ? 1 : 0,
        pageId,
      );
      if (late || statusChanged) run(`update care_pages set last_updated_at = ? where id = ?`, now, pageId);
    }
    log(pageId, actor.userId, actor.displayName, "edited an update", post.preset.label);
  });
}

export function setHidden(pageId: string, actor: CurrentMember, updateId: string, hidden: boolean): void {
  if (!canPost(actor.role)) throw new ActionError("You can't change updates.");
  const existing = one<{ preset: string | null }>(`select preset from updates where id = ? and page_id = ?`, updateId, pageId);
  if (!existing) throw new ActionError("That update isn't on this page.");
  withTx(() => {
    run(`update updates set hidden = ? where id = ?`, hidden ? 1 : 0, updateId);
    log(pageId, actor.userId, actor.displayName, hidden ? "hid an update" : "put an update back", presetLabel(existing.preset));
  });
}

export function quickCheckIn(pageId: string, actor: CurrentMember, kind: "no_change" | "still_in_surgery"): void {
  if (!canPost(actor.role)) throw new ActionError("You can't post on this page.");
  const now = nowIso();
  withTx(() => {
    if (kind === "still_in_surgery") {
      run(
        `update care_pages set current_status = 'procedure', show_critical_to_wider = 0, last_updated_at = ? where id = ?`,
        now,
        pageId,
      );
      log(pageId, actor.userId, actor.displayName, "checked in", "Still in surgery");
    } else {
      run(`update care_pages set last_updated_at = ? where id = ?`, now, pageId);
      log(pageId, actor.userId, actor.displayName, "checked in", "No change");
    }
  });
}

export function setPinnedNote(pageId: string, actor: CurrentMember, raw: string): void {
  if (!canPost(actor.role)) throw new ActionError("You can't change the note.");
  const note = raw.trim();
  if (note.length > 280) throw new ActionError("Keep the pinned note under 280 characters.");
  withTx(() => {
    run(`update care_pages set pinned_note = ? where id = ?`, note, pageId);
    log(pageId, actor.userId, actor.displayName, note ? "updated the pinned note" : "cleared the pinned note", null);
  });
}

export function setReaction(pageId: string, actor: CurrentMember, updateId: string, kind: string): void {
  if (!isReactionKind(kind)) throw new ActionError("Choose a reaction.");
  const update = one<{ id: string; hidden: number }>(
    `select id, hidden from updates where id = ? and page_id = ?`,
    updateId,
    pageId,
  );
  if (!update || update.hidden === 1) throw new ActionError("That update isn't visible.");
  const existing = one<{ kind: string }>(
    `select kind from reactions where update_id = ? and user_id = ?`,
    updateId,
    actor.userId,
  );
  if (existing?.kind === kind) {
    run(`delete from reactions where update_id = ? and user_id = ?`, updateId, actor.userId);
    return;
  }
  if (existing) {
    run(`update reactions set kind = ?, created_at = ? where update_id = ? and user_id = ?`, kind, nowIso(), updateId, actor.userId);
    return;
  }
  run(
    `insert into reactions (update_id, user_id, kind, created_at) values (?, ?, ?, ?)`,
    updateId,
    actor.userId,
    kind,
    nowIso(),
  );
}

export function addPerson(pageId: string, actor: CurrentMember, rawName: string, rawPhone: string, role: string): void {
  const next = asRole(role);
  assertCanAdd(actor.role, next);
  const person = requirePerson(rawName, rawPhone);
  if (memberCount(pageId) >= MEMBER_CAP) throw new ActionError("This page is full.");
  withTx(() => {
    insertMember(pageId, { ...person, role: next }, actor.userId);
    log(pageId, actor.userId, actor.displayName, "added someone", `${person.name}, ${ROLE_LABEL[next].toLowerCase()}`);
  });
}

export function addPeople(pageId: string, actor: CurrentMember, rawList: string, role: string): void {
  const next = asRole(role);
  assertCanAdd(actor.role, next);
  const people = parsePeopleList(rawList);
  if (memberCount(pageId) + people.length > MEMBER_CAP) throw new ActionError("That list is too long for this page.");
  withTx(() => {
    for (const person of people) insertMember(pageId, { ...person, role: next }, actor.userId);
    log(pageId, actor.userId, actor.displayName, "added people", `${people.length} as ${ROLE_LABEL[next].toLowerCase()}`);
  });
}

export function removePerson(pageId: string, actor: CurrentMember, memberId: string): void {
  if (actor.role !== "owner" && actor.role !== "mod") throw new ActionError("You can't remove people.");
  const target = listedMember(pageId, memberId);
  if (target.role === "owner") throw new ActionError("The owner stays on the page.");
  if (actor.role === "mod" && target.role === "mod") throw new ActionError("Only the owner can remove a mod.");
  withTx(() => {
    run(`delete from members where id = ? and page_id = ?`, target.id, pageId);
    run(`delete from sessions where user_id = ?`, target.userId);
    run(`delete from login_codes where page_id = ? and phone = ?`, pageId, target.phone);
    log(pageId, actor.userId, actor.displayName, "removed someone", target.displayName);
  });
}

export function changeTier(pageId: string, actor: CurrentMember, memberId: string, role: string): void {
  const next = asRole(role);
  const target = listedMember(pageId, memberId);
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
  withTx(() => {
    run(`update members set role = ? where id = ? and page_id = ?`, next, target.id, pageId);
    log(pageId, actor.userId, actor.displayName, "changed a tier", `${target.displayName}, ${ROLE_LABEL[next].toLowerCase()}`);
  });
}

export function handOff(pageId: string, actor: CurrentMember, memberId: string): void {
  if (actor.role !== "owner") throw new ActionError("Only the owner can hand this page off.");
  const target = listedMember(pageId, memberId);
  if (target.role !== "mod") throw new ActionError("Choose a mod to become the owner.");
  withTx(() => {
    run(`update members set role = 'mod' where id = ? and page_id = ?`, actor.id, pageId);
    run(`update members set role = 'owner' where id = ? and page_id = ?`, target.id, pageId);
    log(pageId, actor.userId, actor.displayName, "handed off ownership", target.displayName);
  });
}
