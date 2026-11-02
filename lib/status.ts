import type { Role, Status } from "@/lib/types";

export const STATUSES: {
  id: Status;
  label: string;
  tone: Status;
  hint: string;
}[] = [
  { id: "improving", label: "Improving", tone: "improving", hint: "Getting better" },
  { id: "stable", label: "Stable", tone: "stable", hint: "No big changes" },
  {
    id: "declining",
    label: "Declining",
    tone: "declining",
    hint: "Getting worse; the team is working on it",
  },
  {
    id: "procedure",
    label: "In surgery / procedure",
    tone: "procedure",
    hint: "Expect the next update afterward",
  },
  {
    id: "critical",
    label: "Critical",
    tone: "critical",
    hint: "Optional. The wider circle sees softer wording unless you choose to show Critical.",
  },
];

const SOFT_CRITICAL = "Being watched very closely";

export function isStatus(value: string): value is Status {
  return STATUSES.some((status) => status.id === value);
}

export function statusPresentation(
  status: Status,
  role: Role,
  showCriticalToWider: boolean,
): { label: string; tone: Status } {
  if (status === "critical" && role === "wider" && !showCriticalToWider) {
    return { label: SOFT_CRITICAL, tone: "critical" };
  }
  const found = STATUSES.find((item) => item.id === status) ?? STATUSES[1];
  return { label: found.label, tone: found.tone };
}

export function showEditedMark(createdAt: string, editedAt: string | null): boolean {
  if (!editedAt) return false;
  return new Date(editedAt).getTime() - new Date(createdAt).getTime() > 10 * 60 * 1000;
}

export function checkedInAfter(
  pageUpdatedAt: string | null,
  update: { createdAt: string; editedAt: string | null },
): boolean {
  if (!pageUpdatedAt) return false;
  const pageTime = new Date(pageUpdatedAt).getTime();
  const updateTime = new Date(update.editedAt ?? update.createdAt).getTime();
  return pageTime - updateTime > 90 * 1000;
}

export function canPost(role: Role): boolean {
  return role === "owner" || role === "mod";
}

export function canSeeInner(role: Role): boolean {
  return role === "owner" || role === "mod" || role === "inner";
}

export function canManagePeople(role: Role): boolean {
  return role === "owner" || role === "mod";
}

export function viewRole(memberRole: Role, view: string | undefined): { role: Role; preview: boolean } {
  const preview = canPost(memberRole) && view === "wider";
  return { role: preview ? "wider" : memberRole, preview };
}
