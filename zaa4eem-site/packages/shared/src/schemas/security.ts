import { z } from 'zod';

/** A live session, as shown in Settings → Сеансы. */
export const sessionSchema = z.object({
  id: z.string().uuid(),
  /** Derived from the User-Agent at sign-in ("Chrome, Windows"). */
  label: z.string(),
  /** Truncated network, never a precise address. */
  network: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  /** The one this request came from — it gets "этот вход" instead of a revoke button. */
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionSchema>;

export const passkeySchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type PasskeyInfo = z.infer<typeof passkeySchema>;

/** Everything Settings → Безопасность needs to draw itself. */
export const securityOverviewSchema = z.object({
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  hasPassword: z.boolean(),
  totpEnabled: z.boolean(),
  backupCodesLeft: z.number().int().nonnegative(),
  passkeys: z.array(passkeySchema),
  sessions: z.array(sessionSchema),
  /** False when the deployment has no SMTP — the UI then hides every email-based control instead of offering one that silently does nothing. */
  emailAvailable: z.boolean(),
});
export type SecurityOverview = z.infer<typeof securityOverviewSchema>;

export const magicLinkRequestSchema = z.object({
  email: z.string().email(),
});
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;

export const tokenOnlySchema = z.object({ token: z.string().min(10).max(200) });
export type TokenOnlyInput = z.infer<typeof tokenOnlySchema>;

export const totpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Введите 6 цифр из приложения'),
});
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;

export const totpSetupSchema = z.object({
  /** Shown as text so a password manager can take it without a camera. */
  secret: z.string(),
  /** otpauth:// URI the QR encodes. */
  uri: z.string(),
});
export type TotpSetup = z.infer<typeof totpSetupSchema>;

export const backupCodesSchema = z.object({
  /** Plaintext, returned exactly once — only hashes are stored. */
  codes: z.array(z.string()),
});
export type BackupCodes = z.infer<typeof backupCodesSchema>;

/**
 * A login that got past the password but still owes a second factor. The
 * ticket is short-lived and single-purpose; it is not an access token.
 */
export const twoFactorRequiredSchema = z.object({
  twoFactorRequired: z.literal(true),
  ticket: z.string(),
});
export type TwoFactorRequired = z.infer<typeof twoFactorRequiredSchema>;

export const twoFactorSubmitSchema = z.object({
  ticket: z.string().min(10),
  /** Six digits from the app, or one of the backup codes. */
  code: z.string().trim().min(6).max(20),
});
export type TwoFactorSubmitInput = z.infer<typeof twoFactorSubmitSchema>;

export const passwordCheckSchema = z.object({
  password: z.string().min(1).max(200),
});
export type PasswordCheckInput = z.infer<typeof passwordCheckSchema>;

export const passwordCheckResultSchema = z.object({
  score: z.number().int().min(0).max(4),
  verdict: z.enum(['weak', 'fair', 'good', 'strong']),
  label: z.string(),
  advice: z.string().nullable(),
  /**
   * How many times this exact password appears in public breach corpora.
   * null = the check could not run (no egress, service down) — that is
   * reported as "не проверено", never as "всё чисто".
   */
  breachCount: z.number().int().nonnegative().nullable(),
});
export type PasswordCheckResult = z.infer<typeof passwordCheckResultSchema>;

export const renamePasskeySchema = z.object({
  label: z.string().trim().min(1).max(60),
});
export type RenamePasskeyInput = z.infer<typeof renamePasskeySchema>;
