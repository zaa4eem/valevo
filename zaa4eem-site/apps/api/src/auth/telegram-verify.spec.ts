import { createHmac } from 'crypto';
import { verifyTelegramInitData } from './telegram-verify';

const BOT_TOKEN = 'test-bot-token-123456';

function buildInitData(overrides: Record<string, string> = {}): string {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const user = JSON.stringify({ id: 42, first_name: 'Zaa', username: 'zaa4eem' });
  const fields: Record<string, string> = {
    auth_date: authDate,
    user,
    query_id: 'AAH_fixture',
    ...overrides,
  };

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

describe('verifyTelegramInitData', () => {
  it('accepts a correctly signed payload and returns the parsed user', () => {
    const { user } = verifyTelegramInitData(buildInitData(), BOT_TOKEN);
    expect(user.id).toBe(42);
    expect(user.username).toBe('zaa4eem');
  });

  it('rejects a payload signed with the wrong bot token', () => {
    expect(() => verifyTelegramInitData(buildInitData(), 'wrong-token')).toThrow();
  });

  it('rejects a tampered field even if the hash is present', () => {
    const initData = buildInitData();
    const tampered = initData.replace('query_id=AAH_fixture', 'query_id=AAH_evil');
    expect(() => verifyTelegramInitData(tampered, BOT_TOKEN)).toThrow();
  });

  it('rejects an expired auth_date', () => {
    const staleDate = (Math.floor(Date.now() / 1000) - 999_999).toString();
    expect(() => verifyTelegramInitData(buildInitData({ auth_date: staleDate }), BOT_TOKEN)).toThrow();
  });
});
