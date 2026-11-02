"use client";

import { useActionState, useState } from "react";
import { openExistingPage, startCarePage } from "@/lib/actions";
import type { FormState } from "@/lib/types";

const empty: FormState = { error: "" };

function StartPage({ initialError }: { initialError?: string }) {
  const [sent, setSent] = useState(false);
  const [patient, setPatient] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await startCarePage({ patient, name, email, setupCode });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <section className="card stack">
      <h2>Start a care page</h2>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      {sent ? (
        <div className="stack">
          <p>
            We emailed a link to <strong>{email.trim()}</strong>. Open it in this same browser and your page will be
            created.
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
            Back
          </button>
        </div>
      ) : (
        <form onSubmit={sendLink} className="stack">
          <label className="field">
            Patient's first name
            <input
              name="patient"
              required
              maxLength={40}
              autoComplete="off"
              value={patient}
              onChange={(event) => setPatient(event.target.value)}
            />
          </label>
          <label className="field">
            Your name
            <input
              name="name"
              required
              maxLength={40}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            Your email address
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
          <label className="field">
            Setup code
            <span className="quiet">From whoever set this site up.</span>
            <input
              name="setupCode"
              type="password"
              required
              autoComplete="off"
              value={setupCode}
              onChange={(event) => setSetupCode(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={pending}>
            {pending ? "Sending…" : "Email me a link"}
          </button>
          <p className="small muted">
            You'll be the owner. Add the people at the bedside as mods, and everyone else as followers. When you
            aren't sure how close someone is, start them on the wider circle.
          </p>
        </form>
      )}
    </section>
  );
}

export function CreateForms({ error }: { error?: string }) {
  const [opened, open, opening] = useActionState(openExistingPage, empty);

  return (
    <div className="stack">
      <StartPage initialError={error} />
      <section className="card stack">
        <h2>I have a link</h2>
        {opened.error && (
          <p className="banner-error" role="alert">
            {opened.error}
          </p>
        )}
        <form action={open} className="stack">
          <label className="field">
            Page link
            <input name="link" required autoComplete="off" />
          </label>
          <button className="button secondary" disabled={opening}>
            {opening ? "Opening…" : "Open"}
          </button>
        </form>
      </section>
    </div>
  );
}
