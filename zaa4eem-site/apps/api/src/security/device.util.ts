/**
 * Turns a User-Agent into something a person recognises in their sessions
 * list, and an IP into the coarsest thing still useful for "that wasn't me".
 *
 * Neither is security-critical — both are labels. The parsing is
 * deliberately shallow: a wrong guess shows a slightly odd name, while a
 * heavyweight UA-parsing dependency would be a real supply-chain cost for a
 * cosmetic feature.
 */

const BROWSERS: [RegExp, string][] = [
  [/YaBrowser/i, 'Яндекс.Браузер'],
  [/EdgA?\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/Firefox\//i, 'Firefox'],
  [/Chrome\//i, 'Chrome'],
  [/Safari\//i, 'Safari'],
  [/Telegram/i, 'Telegram'],
];

const PLATFORMS: [RegExp, string][] = [
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod/i, 'iPhone/iPad'],
  [/Windows/i, 'Windows'],
  [/Macintosh|Mac OS X/i, 'Mac'],
  [/Linux/i, 'Linux'],
];

export function describeDevice(userAgent?: string | null): string {
  if (!userAgent) return 'Неизвестное устройство';
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(userAgent))?.[1];
  if (browser && platform) return `${browser}, ${platform}`;
  return browser ?? platform ?? 'Неизвестное устройство';
}

/**
 * Truncates to a /24 (IPv4) or /48 (IPv6). Enough to tell "same network as
 * usual" from "somewhere else", without keeping a precise movement log of
 * everyone who signs in.
 */
export function networkPrefix(ip?: string | null): string | null {
  if (!ip) return null;
  // Express reports IPv4-mapped IPv6 for local connections.
  const cleaned = ip.replace(/^::ffff:/, '').trim();
  if (!cleaned) return null;

  if (cleaned.includes(':')) {
    const groups = cleaned.split(':').filter(Boolean).slice(0, 3);
    return groups.length > 0 ? `${groups.join(':')}::/48` : null;
  }

  const octets = cleaned.split('.');
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}
