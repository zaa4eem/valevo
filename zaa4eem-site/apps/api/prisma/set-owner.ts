/**
 * Maintenance script: create-or-update the OWNER account's login email +
 * password, without touching anything else about the account (or any other
 * user). Unlike seed.ts (which only ever creates the *first* owner on a
 * fresh database), this is safe to re-run against a live database whenever
 * the owner's credentials need to be (re)pinned to a specific email.
 *
 * Usage: OWNER_EMAIL=... OWNER_PASSWORD=... npm run owner:set --workspace @zaa4eem/api
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) {
    throw new Error('Set both OWNER_EMAIL and OWNER_PASSWORD in the environment before running this.');
  }

  const passwordHash = await hashPassword(password);
  const existingOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });

  if (existingOwner) {
    const updated = await prisma.user.update({
      where: { id: existingOwner.id },
      data: { email, passwordHash },
    });
    console.log(`Updated existing owner (${updated.id}) — login is now ${email}`);
  } else {
    const owner = await prisma.user.create({
      data: { role: 'OWNER', displayName: 'zaa4eem', email, passwordHash },
    });
    console.log(`Created new owner (${owner.id}) — login is ${email}`);
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
