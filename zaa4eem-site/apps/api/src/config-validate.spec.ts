import { validateEnv } from './config-validate';

describe('validateEnv', () => {
  it('throws when JWT_ACCESS_SECRET is still the infra/.env.example placeholder', () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: 'change-me' })).toThrow(/change-me/);
  });

  it('passes through any real secret unchanged', () => {
    const config = { JWT_ACCESS_SECRET: 'a-real-generated-secret', OTHER: '1' };
    expect(validateEnv(config)).toBe(config);
  });
});
