import Link from "next/link";
import { markNoChange, markStillInSurgery, savePinnedNote } from "@/lib/actions";
import { checkedInAfter, canPost } from "@/lib/status";
import type { CarePage, CurrentMember, UpdateReactions, VisibleUpdate } from "@/lib/types";
import { CopyLink } from "@/components/CopyLink";
import { SignOut } from "@/components/SignOut";
import { StatusChip } from "@/components/StatusChip";
import { SubmitButton } from "@/components/SubmitButton";
import { UpdateCard } from "@/components/UpdateCard";
import { LastUpdated } from "@/components/When";

export function CareHome({
  slug,
  page,
  member,
  latest,
  reactions,
  preview,
  newestHidden,
  error,
  pageUrl,
}: {
  slug: string;
  page: CarePage;
  member: CurrentMember;
  latest: VisibleUpdate | null;
  reactions: UpdateReactions;
  preview: boolean;
  newestHidden: boolean;
  error?: string;
  pageUrl: string;
}) {
  const moderate = canPost(member.role) && !preview;
  const viewerRole = preview ? "wider" : member.role;

  return (
    <div className="stack">
      {preview && (
        <div className="preview-banner">
          <p>You're seeing the wider circle view.</p>
          <Link href={`/p/${slug}`}>Exit preview</Link>
        </div>
      )}
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <h1>{page.patientFirstName}</h1>
        <StatusChip
          status={page.currentStatus}
          role={viewerRole}
          showCriticalToWider={page.showCriticalToWider}
        />
        <LastUpdated iso={page.lastUpdatedAt} />
        {moderate && page.currentStatus === "critical" && !page.showCriticalToWider && (
          <p className="small muted">Wider circle sees “Being watched very closely.”</p>
        )}
        {moderate && (
          <p>
            <Link href={`/p/${slug}?view=wider`}>Preview as wider circle</Link>
          </p>
        )}
      </div>

      <div className="please">
        <p>Please check here instead of calling or texting.</p>
        {page.pinnedNote && <p>{page.pinnedNote}</p>}
      </div>

      {moderate && <CopyLink url={pageUrl} />}

      {latest && checkedInAfter(page.lastUpdatedAt, latest) && (
        <p className="checkin">A caregiver checked in. The update below is unchanged.</p>
      )}
      {!latest && page.lastUpdatedAt && (
        <p className="checkin">A caregiver checked in. There's no written update yet.</p>
      )}
      {moderate && newestHidden && (
        <p className="small">
          A newer update is hidden. <Link href={`/p/${slug}/history`}>See history</Link>
        </p>
      )}

      {latest ? (
        <UpdateCard
          slug={slug}
          update={latest}
          reactions={reactions}
          returnTo={preview ? `/p/${slug}?view=wider` : `/p/${slug}`}
          viewerRole={viewerRole}
          tools={moderate ? "edit" : "none"}
        />
      ) : (
        <section className="card">
          <h2>No update yet</h2>
          <p className="muted">When a caregiver posts, it will show up here.</p>
        </section>
      )}

      {moderate && (
        <div className="modbar">
          <Link className="button primary" href={`/p/${slug}/post`}>
            Post an update
          </Link>
          <div className="modbar-row">
            <form action={markNoChange}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton className="button secondary" pendingLabel="Saving…">
                No change
              </SubmitButton>
            </form>
            <form action={markStillInSurgery}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton className="button secondary" pendingLabel="Saving…">
                Still in surgery
              </SubmitButton>
            </form>
          </div>
        </div>
      )}

      {moderate && (
        <details className="fold">
          <summary>Pinned note</summary>
          <form action={savePinnedNote} className="stack">
            <input type="hidden" name="slug" value={slug} />
            <label className="field">
              <span className="quiet">Optional. Shown under the reminder above.</span>
              <textarea name="pinnedNote" defaultValue={page.pinnedNote} maxLength={280} rows={3} />
            </label>
            <SubmitButton className="button secondary" pendingLabel="Saving…">
              Save note
            </SubmitButton>
          </form>
        </details>
      )}

      <div className="footer-actions">
        <SignOut slug={slug} />
      </div>
    </div>
  );
}
