import { Playfair_Display, Russo_One, Space_Grotesk } from 'next/font/google';

/**
 * The three display faces a Premium user can pick for their own nickname
 * (PremiumStyleFields → nameFont). They used to be pulled in with a plain
 * <link> to fonts.googleapis.com in the document head, which is
 * render-blocking: every single visitor waited on three font families
 * before the first pixel, to style a handful of nicknames that most pages
 * don't even contain.
 *
 * next/font self-hosts them (no third-party round-trip at all) and
 * `preload: false` keeps them out of the critical path — the file is only
 * fetched once text actually rendered in that family appears on screen.
 *
 * Note: Space Grotesk ships no Cyrillic glyphs, so a Russian nickname set
 * to "Техно" falls back to the body font. That was already true with the
 * old <link>; flagged rather than silently swapped for a different face.
 */
export const premiumSpaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
  preload: false,
  variable: '--z-font-premium-space',
});

export const premiumPlayfair = Playfair_Display({
  subsets: ['latin', 'cyrillic'],
  weight: ['700'],
  display: 'swap',
  preload: false,
  variable: '--z-font-premium-serif',
});

export const premiumRussoOne = Russo_One({
  subsets: ['latin', 'cyrillic'],
  weight: ['400'],
  display: 'swap',
  preload: false,
  variable: '--z-font-premium-pixel',
});

export const premiumFontClassNames = [
  premiumSpaceGrotesk.variable,
  premiumPlayfair.variable,
  premiumRussoOne.variable,
].join(' ');
