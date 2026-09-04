import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    return credits.map((c) => ({
      id: c.id,
      description: c.description,
      createdAt: c.createdAt.toISOString(),
      user: { id: c.credited.id, displayName: c.credited.displayName, avatarUrl: c.credited.avatarUrl },
    }));
  }

  async delete(id: string) {
    await this.prisma.ideaCredit.delete({ where: { id } });
  }
}
