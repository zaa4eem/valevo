import { ModerationState } from '../enums';
import { allBannedSubstrings, RESTRICTED_TOPIC_PATTERNS } from './banned-words';

export interface ClassifyResult {
  state: typeof ModerationState.CLEAN | typeof ModerationState.PENDING_REVIEW;
  matchedTerm?: string;
}

/**
 * Pure text classifier shared by the API (server-side, authoritative) and
 * the web app (client-side hint, not a security boundary). A match never
 * discards content — it only routes it to PENDING_REVIEW for the owner
 * (spec.md Edge Cases: "held, not discarded").
 */
export function classifyText(text: string, extraBannedWords: string[] = []): ClassifyResult {
  const normalized = text.toLowerCase();

  for (const pattern of RESTRICTED_TOPIC_PATTERNS) {
    if (pattern.test(text)) {
      return { state: ModerationState.PENDING_REVIEW, matchedTerm: pattern.source };
    }
  }

  for (const word of allBannedSubstrings(extraBannedWords)) {
    if (normalized.includes(word)) {
      return { state: ModerationState.PENDING_REVIEW, matchedTerm: word };
    }
  }

  return { state: ModerationState.CLEAN };
}
