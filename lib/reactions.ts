import type { ReactionKind } from "@/lib/types";

export const REACTIONS: { id: ReactionKind; emoji: string; label: string }[] = [
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "praying", emoji: "🙏", label: "Praying" },
  { id: "strength", emoji: "💪", label: "Strength" },
  { id: "great_news", emoji: "🎉", label: "Great news" },
  { id: "hugs", emoji: "🫂", label: "Hugs" },
];

export function isReactionKind(value: string): value is ReactionKind {
  return REACTIONS.some((reaction) => reaction.id === value);
}

export const ROLE_LABEL = {
  owner: "Owner",
  mod: "Mod",
  inner: "Inner circle",
  wider: "Wider circle",
} as const;
