"use client";

import { useState } from "react";
import { requestSignInLink } from "@/lib/actions";

export function SignIn({ slug, error: initialError }: { slug: string; error?: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await requestSignInLink(slug, email);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <div className="stack">
      <h1>Sign in</h1>
      {sent ? (
        <div className="stack">
          <p>
            We emailed a sign-in link to <strong>{email.trim()}</strong>. Open it in this same browser.
          </p>
          <p className="small muted">It can take a minute. Check spam if you don't see it.</p>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={sendLink}>
          {error && (
            <p className="banner-error" role="alert">
              {error}
            </p>
          )}
          <label className="field">
            Email address
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={pending}>
            {pending ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}
