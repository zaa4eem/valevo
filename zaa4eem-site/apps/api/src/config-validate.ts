/**
 * Refuses to boot with a secret still set to the literal placeholder from
 * infra/.env.example — that value is public (it's committed to git), so an
 * operator who copies the example file and misses this one line would
 * otherwise deploy with a JWT signing secret anyone can read from the repo,
 * letting them forge a valid access token for any account, the owner's
 * included.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  if (config.JWT_ACCESS_SECRET === 'change-me') {
    throw new Error(
      'JWT_ACCESS_SECRET is still the placeholder "change-me" from infra/.env.example — ' +
        'generate a real one (openssl rand -hex 32) before starting the API.',
    );
  }
  return config;
}
