"use client";

import { useEffect, useState } from "react";

function absolute(iso: string, withDate: boolean): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: withDate ? "short" : undefined,
    day: withDate ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

function relative(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (mins < 60 * 36) return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
  const days = Math.round(mins / (60 * 24));
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function LastUpdated({ iso }: { iso: string | null }) {
  const [text, setText] = useState("Last updated");
  useEffect(() => {
    if (!iso) return;
    const render = () => setText(`Last updated ${relative(iso)} (${absolute(iso, false)})`);
    render();
    const id = window.setInterval(render, 30000);
    return () => window.clearInterval(id);
  }, [iso]);
  if (!iso) return <p className="updated">No update yet</p>;
  return (
    <p className="updated">
      <time dateTime={iso}>{text}</time>
    </p>
  );
}

export function When({ iso, prefix }: { iso: string; prefix?: string }) {
  const [text, setText] = useState("…");
  useEffect(() => {
    const abs = absolute(iso, true);
    setText(prefix ? `${prefix} ${abs}` : abs);
  }, [iso, prefix]);
  return <time dateTime={iso}>{text}</time>;
}
