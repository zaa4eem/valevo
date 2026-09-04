import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';
import { KNOWN_GAMES } from '../src/games/known-games';

const prisma = new PrismaClient();

// Mirrors UsersService's generateUniqueReferralCode — duplicated rather than
// imported since this script runs standalone (no Nest DI container) and
// only ever creates the one owner row, so a uniqueness retry loop is
// unnecessary overkill here.
function randomReferralCode(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: 7 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function main() {
  const ownerTelegramId = process.env.OWNER_TELEGRAM_ID
    ? BigInt(process.env.OWNER_TELEGRAM_ID)
    : undefined;
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;

  if (!ownerTelegramId && !(ownerEmail && ownerPassword)) {
    throw new Error(
      'Set OWNER_TELEGRAM_ID and/or (OWNER_EMAIL + OWNER_PASSWORD) in the environment before seeding.',
    );
  }

  const existingOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
  if (existingOwner) {
    console.log(`Owner already exists (${existingOwner.displayName}) — skipping owner seed.`);
  } else {
    const passwordHash = ownerPassword ? await hashPassword(ownerPassword) : undefined;
    const owner = await prisma.user.create({
      data: {
        role: 'OWNER',
        displayName: 'zaa4eem',
        telegramId: ownerTelegramId,
        email: ownerEmail,
        passwordHash,
        referralCode: randomReferralCode(),
      },
    });
    console.log(`Created owner user: ${owner.id}`);
  }

  // Also self-healed on every API boot (GamesService.onModuleInit) — kept
  // here too so a fresh deploy has its games ready before the API's first
  // start, without waiting on that first boot to finish.
  for (const game of KNOWN_GAMES) {
    const ready = await prisma.game.upsert({ where: { slug: game.slug }, update: {}, create: game });
    console.log(`Game ready: ${ready.title} (${ready.slug})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
