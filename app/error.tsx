"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="shell">
      <p className="brand">Bedside</p>
      <h1>Something went wrong</h1>
      <p>Nothing on the page was changed. Try again.</p>
      <button className="button secondary" type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
