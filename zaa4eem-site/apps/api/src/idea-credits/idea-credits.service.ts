import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ensurePremiumFresh } from '../common/premium.util';
import type { User } from '@prisma/client';

function serializeCreditedUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isPremium: user.isPremium,
    nameStyle: user.nameStyle,
    nameColor: user.nameColor,
    ringStyle: user.ringStyle,
    nameFont: user.nameFont,
    badgeEmoji: user.badgeEmoji,
    premiumUntil: user.premiumUntil?.toISOString() ?? null,
  };
}

@Injectable()
export class IdeaCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, description: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const credit = await this.prisma.ideaCredit.create({ data: { creditedId: userId, description } });
    return { id: credit.id, description: credit.description, createdAt: credit.createdAt.toISOString() };
  }

  /** Public "Зал славы" — every credit ever given, newest first. */
  async list() {
    const credits = await this.prisma.ideaCredit.findMany({
      include: { credited: true },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      credits.map(async (c) => {
        const user = await ensurePremiumFresh(this.prisma, c.credited);
        return {
          id: c.id,
          description: c.description,
          createdAt: c.createdAt.toISOString(),
          user: serializeCreditedUser(user),
        };
      }),
    );
  }

  async delete(id: string) {
    await this.prisma.ideaCredit.delete({ where: { id } });
  }
}
