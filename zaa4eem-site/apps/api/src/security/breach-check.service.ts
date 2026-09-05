import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
/** A password check must never make signing up feel broken; give up quickly. */
const TIMEOUT_MS = 2500;

/**
 * "Has this password appeared in a public breach?", asked without ever
 * sending the password anywhere.
 *
 * k-anonymity: we send the first five hex characters of the SHA-1 hash and
 * get back every suffix sharing that prefix — hundreds of them. The service
 * learns a bucket, never the password, and never which of the hundreds was
 * ours. Doing this locally would mean shipping a multi-gigabyte corpus.
 *
 * Fails open on purpose: no egress, a timeout, or a bad response returns
 * null, and the UI reports "не проверено" rather than a false all-clear. A
 * breach service being down must not stop anyone setting a password.
 */
@Injectable()
export class BreachCheckService {
  private readonly logger = new Logger(BreachCheckService.name);

  async countBreaches(password: string): Promise<number | null> {
    if (!password) return null;

    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(`${RANGE_URL}${prefix}`, {
        signal: controller.signal,
        headers: { 'Add-Padding': 'true', 'User-Agent': 'ZAA4EEM-password-check' },
      }).finally(() => clearTimeout(timer));

      if (!res.ok) return null;
      const body = await res.text();

      // The body has to actually look like a range response before a
      // "no match" can be read as "not breached". A captive portal, a proxy
      // error page, or a CDN notice can all arrive with a 200 and no
      // matching suffix — treating that as a clean bill of health would be
      // the one failure mode this check must never have.
      let looksLikeRange = false;
      let found: number | null = null;

      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [candidate, count] = trimmed.split(':');
        if (!/^[0-9A-F]{35}$/.test(candidate ?? '') || !/^\d+$/.test(count ?? '')) {
          // A single malformed line is not a valid range response.
          return null;
        }
        looksLikeRange = true;
        if (candidate === suffix) found = Number.parseInt(count, 10);
      }

      if (!looksLikeRange) return null;
      return found ?? 0;
    } catch (err) {
      this.logger.debug(`Breach check unavailable: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
