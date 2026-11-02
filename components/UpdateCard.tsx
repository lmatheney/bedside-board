import Link from "next/link";
import { reactToUpdate, setUpdateHidden } from "@/lib/actions";
import { presetLabel } from "@/lib/presets";
import { REACTIONS } from "@/lib/reactions";
import { showEditedMark, statusPresentation } from "@/lib/status";
import type { Notify, UpdateReactions, VisibleUpdate } from "@/lib/types";
import { StatusChip } from "@/components/StatusChip";
import { SubmitButton } from "@/components/SubmitButton";
import { When } from "@/components/When";

function notifyLabel(notify: Notify): string {
  if (notify === "everyone") return "Text choice: everyone. Nothing is texted yet.";
  if (notify === "inner") return "Text choice: inner circle only. Nothing is texted yet.";
  return "Quiet post. Nothing is texted.";
}

export function UpdateCard({
  slug,
  update,
  reactions,
  returnTo,
  viewerRole,
  tools = "none",
}: {
  slug: string;
  update: VisibleUpdate;
  reactions: UpdateReactions;
  returnTo: string;
  viewerRole: "owner" | "mod" | "inner" | "wider";
  tools?: "none" | "edit" | "full";
}) {
  const tone = statusPresentation(update.status, viewerRole, update.showCriticalToWider).tone;
  const label = presetLabel(update.preset);
  const edited = showEditedMark(update.createdAt, update.editedAt);

  return (
    <article className={update.hidden ? "update-card is-hidden" : "update-card"} data-tone={tone}>
      <StatusChip status={update.status} role={viewerRole} showCriticalToWider={update.showCriticalToWider} />
      {label && <p className="kicker">{label}</p>}
      {update.hidden && <p className="small">Hidden from followers</p>}
      {update.innerNote !== null ? (
        <>
          <p className="update-body">{update.innerNote}</p>
          {update.latestActions && update.latestActions.length > 0 && (
            <>
              <h3>Latest actions</h3>
              <ul className="actions">
                {update.latestActions.map((action, index) => (
                  <li key={`${index}-${action}`}>{action}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : update.widerSummary ? (
        <p className="update-body">{update.widerSummary}</p>
      ) : (
        <p className="update-body muted">No details were shared with the wider circle.</p>
      )}
      <p className="byline">
        {update.authorName}
        {" · "}
        <When iso={update.createdAt} />
        {edited && update.editedAt && (
          <>
            {" · "}
            <When iso={update.editedAt} prefix="Edited" />
          </>
        )}
      </p>
      {tools === "full" && <p className="small muted">{notifyLabel(update.notify)}</p>}
      <form action={reactToUpdate}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="updateId" value={update.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="react-row">
          {REACTIONS.map((reaction) => {
            const count = reactions.groups.find((group) => group.kind === reaction.id)?.count ?? 0;
            return (
              <button
                key={reaction.id}
                className={reactions.mine === reaction.id ? "react on" : "react"}
                name="kind"
                value={reaction.id}
                aria-pressed={reactions.mine === reaction.id}
              >
                <span aria-hidden="true">{reaction.emoji}</span> {reaction.label}
                {count > 0 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>
      </form>
      {reactions.groups.length > 0 && (
        <details className="fold">
          <summary>Who reacted</summary>
          {reactions.groups.map((group) => {
            const reaction = REACTIONS.find((item) => item.id === group.kind);
            return (
              <p key={group.kind} className="names">
                <span aria-hidden="true">{reaction?.emoji}</span> {reaction?.label}: {group.names.join(", ")}
              </p>
            );
          })}
        </details>
      )}
      {tools !== "none" && (
        <div className="mod-links">
          <Link href={`/p/${slug}/post?update=${update.id}`}>Edit</Link>
          {tools === "full" &&
            (update.hidden ? (
              <form action={setUpdateHidden}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="updateId" value={update.id} />
                <input type="hidden" name="hidden" value="0" />
                <SubmitButton className="button ghost" pendingLabel="Saving…">
                  Put back
                </SubmitButton>
              </form>
            ) : (
              <details className="fold">
                <summary>Hide</summary>
                <form action={setUpdateHidden} className="stack">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="updateId" value={update.id} />
                  <input type="hidden" name="hidden" value="1" />
                  <p className="small">Followers won't see this update. You can put it back.</p>
                  <SubmitButton className="button secondary" pendingLabel="Hiding…">
                    Hide this update
                  </SubmitButton>
                </form>
              </details>
            ))}
        </div>
      )}
    </article>
  );
}
