import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Telegram's Login Widget and Google Identity Services both check the
// browser's exact origin against a single domain registered up front
// (BotFather's /setdomain; Google Cloud Console's "Authorized JavaScript
// origins"). Serving the site on both the apex and www with no redirect
// between them — which infra/docker-compose.yml's WEB_VIRTUAL_HOST does —
// means half of all visitors land on the domain that ISN'T registered, and
// both login buttons then silently fail or bounce to an unrelated page.
// Collapsing everything onto one canonical host fixes that regardless of
// which domain someone typed or followed a link to.
const CANONICAL_HOST = process.env.CANONICAL_HOST;

export function middleware(req: NextRequest) {
  const host = req.headers.get('host');
  if (CANONICAL_HOST && host && host !== CANONICAL_HOST && host.replace(/^www\./, '') === CANONICAL_HOST) {
    const url = req.nextUrl.clone();
    url.protocol = 'https';
    url.host = CANONICAL_HOST;
    url.port = '';
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
