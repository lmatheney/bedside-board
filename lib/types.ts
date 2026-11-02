export type Role = "owner" | "mod" | "inner" | "wider";

export type Status = "improving" | "stable" | "declining" | "procedure" | "critical";

export type Notify = "everyone" | "inner" | "none";

export type ReactionKind = "love" | "praying" | "strength" | "great_news" | "hugs";

export type CarePage = {
  id: string;
  slug: string;
  patientFirstName: string;
  currentStatus: Status;
  showCriticalToWider: boolean;
  lastUpdatedAt: string | null;
  pinnedNote: string;
  createdAt: string;
};

export type CurrentMember = {
  id: string;
  userId: string;
  displayName: string;
  role: Role;
};

export type ListedMember = CurrentMember & {
  email: string;
  createdAt: string;
};

export type VisibleUpdate = {
  id: string;
  status: Status;
  preset: string | null;
  widerSummary: string;
  showCriticalToWider: boolean;
  notify: Notify;
  createdAt: string;
  editedAt: string | null;
  hidden: boolean;
  authorName: string;
  /** Null means this viewer is not allowed to receive the inner-circle note. */
  innerNote: string | null;
  /** Null means this viewer is not allowed to receive latest-action bullets. */
  latestActions: string[] | null;
};

export type ReactionGroup = {
  kind: ReactionKind;
  count: number;
  names: string[];
};

export type UpdateReactions = {
  groups: ReactionGroup[];
  mine: ReactionKind | null;
};

export type ActivityEntry = {
  id: string;
  actorName: string;
  action: string;
  target: string | null;
  at: string;
};

export type PublishInput = {
  status: Status;
  preset: string;
  innerNote: string;
  widerSummary: string;
  latestActions: string;
  notify: Notify;
  showCriticalToWider: boolean;
  updateId?: string;
};

export type FormState = { error: string };
