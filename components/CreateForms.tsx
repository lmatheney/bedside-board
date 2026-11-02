"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createCarePage, openExistingPage, startCarePage } from "@/lib/actions";
import { formatPhone, normalizePhone } from "@/lib/phone";
import type { FormState } from "@/lib/types";

const empty: FormState = { error: "" };

function StartPage() {
  const router = useRouter();
  const [step, setStep] = useState<"details" | "code">("details");
  const [patient, setPatient] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pretty = normalizePhone(phone);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await startCarePage({ patient, name, phone, setupCode });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStep("code");
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await createCarePage({ patient, name, phone, setupCode, code });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    router.push(`/p/${result.slug}`);
  }

  return (
    <section className="card stack">
      <h2>Start a care page</h2>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      {step === "details" ? (
        <form onSubmit={sendCode} className="stack">
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
            Your mobile number
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
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
            {pending ? "Sending…" : "Text me a code"}
          </button>
          <p className="small muted">
            You'll be the owner. Add the people at the bedside as mods, and everyone else as followers. When you
            aren't sure how close someone is, start them on the wider circle.
          </p>
        </form>
      ) : (
        <form onSubmit={create} className="stack">
          <p>Code for {pretty ? formatPhone(pretty) : phone}</p>
          <label className="field">
            6-digit code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={pending}>
            {pending ? "Creating…" : "Create the page"}
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              setStep("details");
              setCode("");
              setError(null);
            }}
          >
            Back
          </button>
        </form>
      )}
    </section>
  );
}

export function CreateForms() {
  const [opened, open, opening] = useActionState(openExistingPage, empty);

  return (
    <div className="stack">
      <StartPage />
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
