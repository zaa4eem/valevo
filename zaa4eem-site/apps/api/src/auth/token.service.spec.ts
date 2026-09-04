import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';

function makeConfig(): ConfigService {
  const store: Record<string, string> = { JWT_ACCESS_SECRET: 'test-secret' };
  return {
    getOrThrow: (key: string) => store[key],
    get: (key: string) => store[key],
  } as unknown as ConfigService;
}

describe('TokenService (access tokens)', () => {
  it('round-trips a signed access token', () => {
    const jwt = new JwtService({});
    const prisma = {} as any;
    const service = new TokenService(jwt, makeConfig(), prisma);

    const token = service.signAccessToken({ sub: 'user-1', role: 'SUBSCRIBER' });
    const decoded = service.verifyAccessToken(token);

    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('SUBSCRIBER');
  });

  it('rejects a token signed with a different secret', () => {
    const jwt = new JwtService({});
    const prisma = {} as any;
    const signer = new TokenService(jwt, makeConfig(), prisma);
    const token = signer.signAccessToken({ sub: 'user-1', role: 'SUBSCRIBER' });

    const otherConfig = {
      getOrThrow: () => 'a-different-secret',
      get: () => 'a-different-secret',
    } as unknown as ConfigService;
    const verifier = new TokenService(jwt, otherConfig, prisma);

    expect(() => verifier.verifyAccessToken(token)).toThrow();
  });
});

describe('TokenService (refresh tokens)', () => {
  /** A minimal in-memory stand-in for prisma.refreshToken, matching only the where-clause shapes TokenService actually issues. */
  function fakeRefreshTokenModel(stored: any[]) {
    function matches(row: any, where: any): boolean {
      if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
      if (where.userId !== undefined && row.userId !== where.userId) return false;
      if (where.revokedAt === null && row.revokedAt !== null) return false;
      if (where.revokedAt?.not === null && row.revokedAt === null) return false;
      if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) return false;
      return true;
    }
    return {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `rt-${stored.length}`, revokedAt: null, ...data };
        stored.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => stored.find((r) => matches(r, where)) ?? null),
      findFirstOrThrow: jest.fn(async ({ where }: any) => {
        const row = stored.find((r) => matches(r, where));
        if (!row) throw new Error('NotFoundError');
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matched = stored.filter((r) => matches(r, where));
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      }),
    };
  }

  it('rotates a valid refresh token exactly once', async () => {
    const jwt = new JwtService({});
    const stored: any[] = [];
    const prisma = { refreshToken: fakeRefreshTokenModel(stored) } as any;
    const service = new TokenService(jwt, makeConfig(), prisma);

    const raw = await service.issueRefreshToken('user-1');
    const rotated = await service.rotateRefreshToken(raw);
    expect(rotated?.userId).toBe('user-1');

    const secondAttempt = await service.rotateRefreshToken(raw);
    expect(secondAttempt).toBeNull();
  });

  it('revokes every session for the user when an already-rotated token is replayed', async () => {
    const jwt = new JwtService({});
    const stored: any[] = [];
    const prisma = { refreshToken: fakeRefreshTokenModel(stored) } as any;
    const service = new TokenService(jwt, makeConfig(), prisma);

    const raw = await service.issueRefreshToken('user-1');
    const otherRaw = await service.issueRefreshToken('user-1'); // a second, independent active session
    const rotated = await service.rotateRefreshToken(raw);
    expect(rotated).not.toBeNull();

    // Replaying the now-revoked original token (stolen-token scenario) must
    // fail AND take out every other active session for this user — not
    // just this one token.
    const replay = await service.rotateRefreshToken(raw);
    expect(replay).toBeNull();

    const otherSession = stored.find((r) => r.tokenHash === (service as any).hashRefreshToken(otherRaw));
    expect(otherSession.revokedAt).not.toBeNull();
    const rotatedSession = stored.find((r) => r.tokenHash === (service as any).hashRefreshToken(rotated!.newRaw));
    expect(rotatedSession.revokedAt).not.toBeNull();
  });

});
