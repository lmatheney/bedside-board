import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { UpdateCard } from "@/components/UpdateCard";
import { listUpdates, reactionsFor } from "@/lib/data";
import { loadPage } from "@/lib/guard";
import { canManagePeople, canPost, viewRole } from "@/lib/status";

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadPage(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind !== "ready") redirect(`/p/${slug}`);

  const { page, member } = loaded;
  const { role, preview } = viewRole(member.role, query.view);
  const updates = await listUpdates(page.id, role, canPost(member.role) && !preview);
  const reactions = await reactionsFor(
    page.id,
    updates.map((update) => update.id),
    member.userId,
  );
  const returnTo = preview ? `/p/${slug}/history?view=wider` : `/p/${slug}/history`;
  const links = [
    { href: preview ? `/p/${slug}?view=wider` : `/p/${slug}`, label: "Page" },
    ...(!preview && canManagePeople(member.role) ? [{ href: `/p/${slug}/people`, label: "People" }] : []),
  ];

  return (
    <Shell links={links}>
      <p className="kicker">{page.patientFirstName}</p>
      <h1>History</h1>
      {query.error && (
        <p className="banner-error" role="alert">
          {query.error}
        </p>
      )}
      {updates.length === 0 ? (
        <section className="card">
          <p>No updates yet.</p>
        </section>
      ) : (
        updates.map((update) => (
          <UpdateCard
            key={update.id}
            slug={slug}
            update={update}
            reactions={reactions.get(update.id) ?? { groups: [], mine: null }}
            returnTo={returnTo}
            viewerRole={role}
            tools={canPost(member.role) && !preview ? "full" : "none"}
          />
        ))
      )}
      <p>
        <Link href={preview ? `/p/${slug}?view=wider` : `/p/${slug}`}>Back to the page</Link>
      </p>
    </Shell>
  );
}
