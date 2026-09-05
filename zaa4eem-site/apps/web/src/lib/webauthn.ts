import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from '@/lib/api-client';

/**
 * Passkeys, browser side. The library's job here is small but fiddly: it
 * converts the base64url strings the server speaks into the ArrayBuffers
 * `navigator.credentials` demands, and back again.
 */

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/** True when the device itself can be the authenticator (Face ID, Windows Hello, a fingerprint reader). */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Adds a passkey to the account already signed in. */
export async function registerPasskey(): Promise<void> {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/security/passkeys/begin');
  const response = await startRegistration({ optionsJSON: options });
  await api.post('/security/passkeys/finish', response);
}

/** Signs in with a passkey. The browser picks the account, so nothing is typed. */
export async function loginWithPasskey(): Promise<LoginResult> {
  const options = await api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkey/begin');
  const response = await startAuthentication({ optionsJSON: options });
  return api.post<LoginResult>('/auth/passkey/finish', response);
}

/**
 * A user cancelling the system prompt is not an error worth showing — it is
 * them deciding not to. Everything else is.
 */
export function isCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}

type PublicKeyCredentialCreationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON'];
type PublicKeyCredentialRequestOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON'];

interface LoginResult {
  accessToken: string;
  user: unknown;
}
