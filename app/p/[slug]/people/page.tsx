import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CopyLink } from "@/components/CopyLink";
import { Shell } from "@/components/Shell";
import { SubmitButton } from "@/components/SubmitButton";
import { When } from "@/components/When";
import {
  addPeopleAction,
  addPersonAction,
  changeTierAction,
  handOffAction,
  removePersonAction,
} from "@/lib/actions";
import { listActivity, listMembers } from "@/lib/data";
import { loadPage } from "@/lib/guard";
import { requestOrigin } from "@/lib/origin";
import { formatPhone } from "@/lib/phone";
import { ROLE_LABEL } from "@/lib/reactions";
import { canManagePeople } from "@/lib/status";
import type { CurrentMember, ListedMember, Role } from "@/lib/types";

function tierOptions(actor: Role, target: Role): Role[] {
  if (actor === "owner") return target === "mod" ? ["mod", "inner", "wider"] : ["wider", "inner", "mod"];
  return ["wider", "inner"];
}

function PersonRow({ slug, actor, person }: { slug: string; actor: CurrentMember; person: ListedMember }) {
  const canChange = person.role !== "owner" && (actor.role === "owner" || person.role !== "mod");
  const canRemove = person.role !== "owner" && (actor.role === "owner" || person.role !== "mod");
  return (
    <div className="person">
      <h3>{person.displayName}</h3>
      <p className="phone">{formatPhone(person.phone)}</p>
      <p className="small muted">{ROLE_LABEL[person.role]}</p>
      {actor.role === "owner" && person.role === "mod" && (
        <form action={handOffAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="memberId" value={person.id} />
          <SubmitButton className="button secondary" pendingLabel="Handing off…">
            Make owner
          </SubmitButton>
        </form>
      )}
      {canChange && (
        <form action={changeTierAction} className="row-actions">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="memberId" value={person.id} />
          <label className="field">
            <span className="quiet">Tier</span>
            <select name="role" defaultValue={person.role} aria-label={`Tier for ${person.displayName}`}>
              {tierOptions(actor.role, person.role).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton className="button secondary" pendingLabel="Moving…">
            Move
          </SubmitButton>
        </form>
      )}
      {canRemove && (
        <details className="remove">
          <summary>Remove</summary>
          <form action={removePersonAction} className="stack">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="memberId" value={person.id} />
            <p className="small">{person.displayName} loses access immediately. No text is sent.</p>
            <SubmitButton className="button danger" pendingLabel="Removing…">
              Remove {person.displayName}
            </SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const loaded = await loadPage(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind !== "ready") redirect(`/p/${slug}`);
  if (!canManagePeople(loaded.member.role)) redirect(`/p/${slug}`);

  const members = await listMembers(loaded.page.id);
  const activity = loaded.member.role === "owner" ? await listActivity(loaded.page.id) : [];
  const origin = await requestOrigin();
  const groups: Role[] = ["owner", "mod", "inner", "wider"];

  return (
    <Shell
      links={[
        { href: `/p/${slug}`, label: "Page" },
        { href: `/p/${slug}/history`, label: "History" },
      ]}
    >
      <p className="kicker">{loaded.page.patientFirstName}</p>
      <h1>People</h1>
      <p className="muted">Followers can't see this list or each other's numbers.</p>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      <CopyLink url={`${origin}/p/${slug}`} />

      <section className="card stack">
        <h2>Add someone</h2>
        <p className="small muted">
          Wider circle is selected on purpose. You can move someone to the inner circle later. Moving them back can't
          unsend what they already read. Texting isn't on yet, so send them the link yourself.
        </p>
        <form action={addPersonAction} className="stack">
          <input type="hidden" name="slug" value={slug} />
          <label className="field">
            Name
            <input name="name" required maxLength={40} autoComplete="name" />
          </label>
          <label className="field">
            Mobile number
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
          </label>
          <label className="field">
            Tier
            <select name="role" defaultValue="wider">
              <option value="wider">Wider circle</option>
              <option value="inner">Inner circle</option>
              {loaded.member.role === "owner" && <option value="mod">Mod</option>}
            </select>
          </label>
          <SubmitButton className="button primary" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </form>
        <details className="fold">
          <summary>Add several</summary>
          <form action={addPeopleAction} className="stack">
            <input type="hidden" name="slug" value={slug} />
            <label className="field">
              <span className="quiet">One person per line: Name, phone</span>
              <textarea name="list" required placeholder={"Sam Rivera, 555-200-0002\nJo Patel, 555-200-0003"} />
            </label>
            <label className="field">
              Tier for everyone in the list
              <select name="role" defaultValue="wider">
                <option value="wider">Wider circle</option>
                <option value="inner">Inner circle</option>
                {loaded.member.role === "owner" && <option value="mod">Mod</option>}
              </select>
            </label>
            <SubmitButton className="button secondary" pendingLabel="Adding…">
              Add the list
            </SubmitButton>
          </form>
        </details>
      </section>

      {groups.map((role) => {
        const people = members.filter((person) => person.role === role);
        return (
          <section key={role}>
            <h2>{ROLE_LABEL[role]}</h2>
            {role === "mod" && <p className="small muted">People at the bedside. Two to four is enough.</p>}
            {role === "inner" && (
              <p className="small muted">They see the full note and the latest-action lines.</p>
            )}
            {role === "wider" && <p className="small muted">They see the short summary and the status.</p>}
            {people.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              people.map((person) => (
                <PersonRow key={person.id} slug={slug} actor={loaded.member} person={person} />
              ))
            )}
          </section>
        );
      })}

      {loaded.member.role === "owner" && (
        <section>
          <h2>Activity</h2>
          {activity.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul className="log">
              {activity.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.actorName} {entry.action}
                    {entry.target ? ` · ${entry.target}` : ""}
                  </span>
                  <When iso={entry.at} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Shell>
  );
}
