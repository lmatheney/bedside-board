import { statusPresentation } from "@/lib/status";
import type { Role, Status } from "@/lib/types";

export function StatusChip({
  status,
  role,
  showCriticalToWider,
}: {
  status: Status;
  role: Role;
  showCriticalToWider: boolean;
}) {
  const presentation = statusPresentation(status, role, showCriticalToWider);
  return (
    <span className="chip" data-tone={presentation.tone}>
      <span className="dot" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}
