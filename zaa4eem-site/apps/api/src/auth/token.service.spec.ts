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
  it('rotates a valid refresh token exactly once', async () => {
    const jwt = new JwtService({});
    const stored: any[] = [];
    const prisma = {
      refreshToken: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `rt-${stored.length}`, revokedAt: null, ...data };
          stored.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) =>
          stored.find(
            (r) => r.tokenHash === where.tokenHash && !r.revokedAt && r.expiresAt > new Date(),
          ) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = stored.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
    } as any;
    const service = new TokenService(jwt, makeConfig(), prisma);

    const raw = await service.issueRefreshToken('user-1');
    const rotated = await service.rotateRefreshToken(raw);
    expect(rotated?.userId).toBe('user-1');

    const secondAttempt = await service.rotateRefreshToken(raw);
    expect(secondAttempt).toBeNull();
  });
});
