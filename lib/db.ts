import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const globalForDb = globalThis as unknown as { bedsideDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globalForDb.bedsideDb) {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "bedside.sqlite"), { timeout: 5000 });
    db.prepare("PRAGMA journal_mode = WAL").get();
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    globalForDb.bedsideDb = db;
  }
  return globalForDb.bedsideDb;
}

export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function many<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]): void {
  getDb().prepare(sql).run(...params);
}

export function withTx(fn: () => void): void {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction is already closed.
    }
    throw error;
  }
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    create table if not exists users (
      id text primary key,
      phone text not null unique,
      created_at text not null
    );

    create table if not exists sessions (
      token_hash text primary key,
      user_id text not null references users(id),
      created_at text not null,
      expires_at text not null
    );

    create table if not exists care_pages (
      id text primary key,
      slug text not null unique,
      patient_first_name text not null,
      current_status text not null check (current_status in ('improving','stable','declining','procedure','critical')),
      show_critical_to_wider integer not null default 0 check (show_critical_to_wider in (0, 1)),
      last_updated_at text,
      pinned_note text not null default '',
      created_at text not null,
      closed_at text
    );

    create table if not exists members (
      id text primary key,
      page_id text not null references care_pages(id),
      user_id text not null references users(id),
      display_name text not null,
      role text not null check (role in ('owner','mod','inner','wider')),
      texts_muted integer not null default 0 check (texts_muted in (0, 1)),
      added_by text references users(id),
      created_at text not null,
      unique (page_id, user_id)
    );

    create unique index if not exists members_one_owner on members(page_id) where role = 'owner';

    create table if not exists updates (
      id text primary key,
      page_id text not null references care_pages(id),
      status text not null check (status in ('improving','stable','declining','procedure','critical')),
      preset text,
      wider_summary text not null,
      show_critical_to_wider integer not null default 0 check (show_critical_to_wider in (0, 1)),
      notify text not null check (notify in ('everyone','inner','none')),
      created_by text not null references users(id),
      created_at text not null,
      edited_at text,
      hidden integer not null default 0 check (hidden in (0, 1))
    );

    create table if not exists update_details (
      update_id text primary key references updates(id),
      inner_note text not null,
      latest_actions text not null
    );

    create table if not exists reactions (
      update_id text not null references updates(id),
      user_id text not null references users(id),
      kind text not null check (kind in ('love','praying','strength','great_news','hugs')),
      created_at text not null,
      primary key (update_id, user_id)
    );

    create table if not exists login_codes (
      id text primary key,
      page_id text not null references care_pages(id),
      phone text not null,
      code_hash text not null,
      created_at text not null,
      expires_at text not null,
      attempts integer not null default 0,
      invalidated integer not null default 0 check (invalidated in (0, 1))
    );

    create table if not exists activity_log (
      id text primary key,
      page_id text not null references care_pages(id),
      actor_id text,
      actor_name text not null,
      action text not null,
      target text,
      at text not null
    );

    create index if not exists updates_page_created on updates(page_id, created_at desc);
    create index if not exists members_page on members(page_id);
    create index if not exists sessions_user on sessions(user_id);
  `);
}
