"use client";

import { useState } from "react";
import { signOut } from "@/lib/actions";

export function SignOut({ slug }: { slug?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      className="button ghost"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const formData = new FormData();
        if (slug) formData.set("slug", slug);
        const next = await signOut(formData);
        window.location.assign(next);
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
