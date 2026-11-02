"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveUpdate } from "@/lib/actions";
import { draftsFor, PRESETS } from "@/lib/presets";
import { STATUSES } from "@/lib/status";
import type { Notify, Status } from "@/lib/types";
import { StatusChip } from "@/components/StatusChip";

export function ComposeForm({
  slug,
  patientName,
  initial,
}: {
  slug: string;
  patientName: string;
  initial: {
    updateId?: string;
    status: Status;
    preset: string;
    innerNote: string;
    widerSummary: string;
    latestActions: string;
    showCriticalToWider: boolean;
  };
}) {
  const router = useRouter();
  const editing = Boolean(initial.updateId);
  const [status, setStatus] = useState<Status>(initial.status);
  const [preset, setPreset] = useState(initial.preset);
  const [innerNote, setInnerNote] = useState(initial.innerNote);
  const [widerSummary, setWiderSummary] = useState(initial.widerSummary);
  const [latestActions, setLatestActions] = useState(initial.latestActions);
  const [notify, setNotify] = useState<Notify>("everyone");
  const [showCritical, setShowCritical] = useState(initial.showCriticalToWider);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hint = STATUSES.find((item) => item.id === status)?.hint;
  const actions = latestActions.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const showWord = status === "critical" && showCritical;

  function choosePreset(id: string) {
    setPreset(id);
    const drafts = draftsFor(id, patientName);
    setInnerNote(drafts.inner);
    setWiderSummary(drafts.wider);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await saveUpdate(slug, {
      updateId: initial.updateId,
      status,
      preset,
      innerNote,
      widerSummary,
      latestActions,
      notify,
      showCriticalToWider: showWord,
    });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    router.push(`/p/${slug}`);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <fieldset>
        <legend>Status</legend>
        <p className="small muted">Leave this if it hasn't changed. {hint}</p>
        <div className="choices">
          {STATUSES.map((item) => (
            <label className="choice" key={item.id}>
              <input
                type="radio"
                name="status"
                checked={status === item.id}
                onChange={() => setStatus(item.id)}
              />
              <StatusChip status={item.id} role="owner" showCriticalToWider />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        Preset
        <span className="quiet">Choosing one fills both drafts. Replace anything in square brackets.</span>
        <select value={preset} onChange={(event) => choosePreset(event.target.value)} required>
          <option value="">Choose a preset</option>
          {PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Inner circle
        <span className="quiet">Family and close friends. This never goes to the wider circle.</span>
        <textarea
          value={innerNote}
          onChange={(event) => setInnerNote(event.target.value)}
          maxLength={2000}
          required
          placeholder="What close family should know"
        />
      </label>

      <label className="field">
        Wider circle
        <span className="quiet">Coworkers and acquaintances. Keep it short and gentle.</span>
        <textarea
          value={widerSummary}
          onChange={(event) => setWiderSummary(event.target.value)}
          maxLength={2000}
          placeholder={preset === "freeform" ? "Optional" : "A short summary"}
        />
      </label>

      <label className="field">
        Latest actions
        <span className="quiet">One per line. Inner circle only. Meds, rounds, a PT visit.</span>
        <textarea
          value={latestActions}
          onChange={(event) => setLatestActions(event.target.value)}
          maxLength={1200}
          placeholder={"Changed pain medication\nDoctor rounds at 2"}
        />
      </label>

      {status === "critical" && (
        <label className="choice">
          <input type="checkbox" checked={showCritical} onChange={(event) => setShowCritical(event.target.checked)} />
          <span className="quiet">Show the word Critical to the wider circle. Otherwise they see “Being watched very closely.”</span>
        </label>
      )}

      {!editing && (
        <fieldset>
          <legend>Text who?</legend>
          <p className="small muted">
            Texting isn't on yet. This choice is saved. For now, paste the page link into the family chat.
          </p>
          <div className="choices">
            <label className="choice">
              <input type="radio" name="notify" checked={notify === "everyone"} onChange={() => setNotify("everyone")} />
              Everyone
            </label>
            <label className="choice">
              <input type="radio" name="notify" checked={notify === "inner"} onChange={() => setNotify("inner")} />
              Inner circle only
            </label>
            <label className="choice">
              <input type="radio" name="notify" checked={notify === "none"} onChange={() => setNotify("none")} />
              Don't text (quiet post)
            </label>
          </div>
        </fieldset>
      )}
      {editing && <p className="small muted">Saving a fix won't text anyone.</p>}

      <section>
        <h2>Preview</h2>
        <div className="preview-grid">
          <div className="preview-card">
            <h3>Inner circle will see</h3>
            <StatusChip status={status} role="inner" showCriticalToWider={showWord} />
            <p className="update-body">{innerNote || "The inner note is empty."}</p>
            {actions.length > 0 && (
              <ul className="actions">
                {actions.map((action, index) => (
                  <li key={`${index}-${action}`}>{action}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="preview-card">
            <h3>Wider circle will see</h3>
            <StatusChip status={status} role="wider" showCriticalToWider={showWord} />
            <p className="update-body">{widerSummary || "No public summary. They'll see the status and the time."}</p>
          </div>
        </div>
      </section>

      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending || preset === "" || innerNote.trim() === ""}>
        {pending ? "Saving…" : editing ? "Save" : "Post"}
      </button>
    </form>
  );
}
