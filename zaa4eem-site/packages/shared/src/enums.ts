// Mirrors the enums defined in apps/api/prisma/schema.prisma.
// Kept as plain TS unions (not imported from @prisma/client) so this
// package has zero dependency on the database layer.

export const UserRole = { OWNER: 'OWNER', SUBSCRIBER: 'SUBSCRIBER' } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = { ACTIVE: 'ACTIVE', MUTED: 'MUTED', BANNED: 'BANNED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const IdeaStatus = {
  NEW: 'NEW',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  SHIPPED: 'SHIPPED',
  DECLINED: 'DECLINED',
} as const;
export type IdeaStatus = (typeof IdeaStatus)[keyof typeof IdeaStatus];

export const ModerationState = {
  CLEAN: 'CLEAN',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REMOVED: 'REMOVED',
} as const;
export type ModerationState = (typeof ModerationState)[keyof typeof ModerationState];

export const ScoreReviewState = { NORMAL: 'NORMAL', HELD_FOR_REVIEW: 'HELD_FOR_REVIEW' } as const;
export type ScoreReviewState = (typeof ScoreReviewState)[keyof typeof ScoreReviewState];

export const ModerationTargetType = {
  IDEA: 'IDEA',
  POST: 'POST',
  USER: 'USER',
  SCORE: 'SCORE',
} as const;
export type ModerationTargetType =
  (typeof ModerationTargetType)[keyof typeof ModerationTargetType];

/** Forward-only lifecycle order for Idea.status; DECLINED is reachable from any non-terminal state. */
export const IDEA_STATUS_ORDER: IdeaStatus[] = [
  IdeaStatus.NEW,
  IdeaStatus.UNDER_REVIEW,
  IdeaStatus.ACCEPTED,
  IdeaStatus.IN_PROGRESS,
  IdeaStatus.SHIPPED,
];
