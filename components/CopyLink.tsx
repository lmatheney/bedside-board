"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="stack">
      <div className="copy-row">
        <label className="field">
          Page link
          <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <button
          className="button secondary"
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="small muted">Nothing medical is in this link. People still sign in with their own number.</p>
    </div>
  );
}
