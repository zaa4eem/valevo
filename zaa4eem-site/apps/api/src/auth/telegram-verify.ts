import { createHash, createHmac, timingSafeEqual } from 'crypto';

export interface TelegramUserPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies Telegram Mini App `initData` per Telegram's documented algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Never trust the parsed payload before this returns successfully.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): { user: TelegramUserPayload; authDate: number } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new Error('initData is missing the hash field');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const computedBuf = Buffer.from(computedHash, 'hex');
  const providedBuf = Buffer.from(hash, 'hex');
  if (
    computedBuf.length !== providedBuf.length ||
    !timingSafeEqual(computedBuf, providedBuf)
  ) {
    throw new Error('initData signature is invalid');
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) {
    throw new Error('initData has expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData is missing the user field');
  }

  const user = JSON.parse(userRaw) as TelegramUserPayload;
  return { user, authDate };
}

/** Verifies the classic Telegram Login Widget payload (used on the plain website login page). */
export function verifyTelegramLoginWidget(
  data: Record<string, string | number>,
  botToken: string,
): boolean {
  const { hash, ...rest } = data;
  if (!hash || typeof hash !== 'string') return false;

  const dataCheckString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const computedBuf = Buffer.from(computedHash, 'hex');
  const providedBuf = Buffer.from(hash, 'hex');
  return (
    computedBuf.length === providedBuf.length && timingSafeEqual(computedBuf, providedBuf)
  );
}
