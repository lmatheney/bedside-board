import { notFound } from "next/navigation";
import { CareHome } from "@/components/CareHome";
import { NoAccess } from "@/components/NoAccess";
import { Shell } from "@/components/Shell";
import { SignIn } from "@/components/SignIn";
import { latestUpdate, newestUpdateIsHidden, reactionsFor } from "@/lib/data";
import { loadPage } from "@/lib/guard";
import { requestOrigin } from "@/lib/origin";
import { canManagePeople, canPost, viewRole } from "@/lib/status";

export default async function CarePage({
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
  if (loaded.kind === "signed-out") {
    return (
      <Shell>
        <SignIn slug={slug} />
      </Shell>
    );
  }
  if (loaded.kind === "forbidden") {
    return (
      <Shell>
        <NoAccess slug={slug} />
      </Shell>
    );
  }

  const { page, member } = loaded;
  const { role, preview } = viewRole(member.role, query.view);
  const latest = latestUpdate(page.id, role);
  const reactions = reactionsFor(page.id, latest ? [latest.id] : [], member.userId);
  const origin = await requestOrigin();
  const links = preview
    ? [{ href: `/p/${slug}/history?view=wider`, label: "History" }]
    : [
        { href: `/p/${slug}/history`, label: "History" },
        ...(canManagePeople(member.role) ? [{ href: `/p/${slug}/people`, label: "People" }] : []),
      ];

  return (
    <Shell links={links}>
      <CareHome
        slug={slug}
        page={page}
        member={member}
        latest={latest}
        reactions={reactions.get(latest?.id ?? "") ?? { groups: [], mine: null }}
        preview={preview}
        newestHidden={canPost(member.role) && !preview && newestUpdateIsHidden(page.id)}
        error={query.error}
        pageUrl={`${origin}/p/${slug}`}
      />
    </Shell>
  );
}
