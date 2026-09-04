import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';

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

  const neonSnake = await prisma.game.upsert({
    where: { slug: 'neon-snake' },
    update: {},
    create: {
      slug: 'neon-snake',
      title: 'Neon Snake',
      description: 'Classic snake, zaa4eem style — chase the green, avoid yourself.',
      maxPlausibleScore: 500,
    },
  });
  console.log(`Game ready: ${neonSnake.title} (${neonSnake.slug})`);

  const zClicker = await prisma.game.upsert({
    where: { slug: 'z-clicker' },
    update: {},
    create: {
      slug: 'z-clicker',
      title: 'Z-Кликер',
      description: 'Кликай и копи Z-коины — потрать их на апгрейды или на Premium в магазине.',
      // Not a score-based game — this is unused by the clicker's own zCoins
      // leaderboard, just required by the shared Game row shape.
      maxPlausibleScore: 1_000_000,
    },
  });
  console.log(`Game ready: ${zClicker.title} (${zClicker.slug})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
