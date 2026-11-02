import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ComposeForm } from "@/components/ComposeForm";
import { Shell } from "@/components/Shell";
import { getEditableUpdate } from "@/lib/data";
import { loadPage } from "@/lib/guard";
import { canManagePeople, canPost } from "@/lib/status";

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ update?: string }>;
}) {
  const { slug } = await params;
  const { update: updateId } = await searchParams;
  const loaded = await loadPage(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind !== "ready") redirect(`/p/${slug}`);
  if (!canPost(loaded.member.role)) redirect(`/p/${slug}`);

  const existing = updateId ? await getEditableUpdate(loaded.page.id, updateId) : null;
  if (updateId && !existing) {
    return (
      <Shell links={[{ href: `/p/${slug}`, label: "Page" }]}>
        <h1>That update isn't on this page.</h1>
        <p>
          <Link href={`/p/${slug}/post`}>Start a new one</Link>
        </p>
      </Shell>
    );
  }

  const links = [
    { href: `/p/${slug}`, label: "Page" },
    { href: `/p/${slug}/history`, label: "History" },
    ...(canManagePeople(loaded.member.role) ? [{ href: `/p/${slug}/people`, label: "People" }] : []),
  ];

  return (
    <Shell wide links={links}>
      <p className="kicker">{loaded.page.patientFirstName}</p>
      <h1>{existing ? "Fix this update" : "Post an update"}</h1>
      <ComposeForm
        key={existing?.id ?? "new"}
        slug={slug}
        patientName={loaded.page.patientFirstName}
        initial={{
          updateId: existing?.id,
          status: existing?.status ?? loaded.page.currentStatus,
          preset: existing?.preset ?? "",
          innerNote: existing?.innerNote ?? "",
          widerSummary: existing?.widerSummary ?? "",
          latestActions: existing?.latestActions?.join("\n") ?? "",
          showCriticalToWider: existing?.showCriticalToWider ?? false,
        }}
      />
    </Shell>
  );
}
