import { SignOut } from "@/components/SignOut";

export function NoAccess({ slug }: { slug: string }) {
  return (
    <>
      <h1>You don't have access to this page.</h1>
      <p>If a caregiver removed you, this is the end of it. No message was sent.</p>
      <SignOut slug={slug} />
    </>
  );
}
