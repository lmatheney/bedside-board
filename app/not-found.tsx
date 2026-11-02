import { Shell } from "@/components/Shell";

export default function NotFound() {
  return (
    <Shell>
      <h1>This page doesn't exist.</h1>
      <p className="muted">Check the link and try again.</p>
    </Shell>
  );
}
