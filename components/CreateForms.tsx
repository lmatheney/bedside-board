"use client";

import { useActionState } from "react";
import { createCarePage, openExistingPage } from "@/lib/actions";
import type { FormState } from "@/lib/types";

const empty: FormState = { error: "" };

export function CreateForms() {
  const [created, create, creating] = useActionState(createCarePage, empty);
  const [opened, open, opening] = useActionState(openExistingPage, empty);

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Start a care page</h2>
        {created.error && (
          <p className="banner-error" role="alert">
            {created.error}
          </p>
        )}
        <form action={create} className="stack">
          <label className="field">
            Patient's first name
            <input name="patient" required maxLength={40} autoComplete="off" />
          </label>
          <label className="field">
            Your name
            <input name="name" required maxLength={40} autoComplete="name" />
          </label>
          <label className="field">
            Your mobile number
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
          </label>
          <button className="button primary" disabled={creating}>
            {creating ? "Creating…" : "Create the page"}
          </button>
          <p className="small muted">
            You'll be the owner. Add the people at the bedside as mods, and everyone else as followers. When you
            aren't sure how close someone is, start them on the wider circle.
          </p>
        </form>
      </section>
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
