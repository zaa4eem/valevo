import { Injectable } from '@nestjs/common';
import { ModerationState } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';

const RESULT_LIMIT = 8;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** Non-owners only ever see CLEAN/APPROVED content, same visibility rule as the posts/ideas boards. */
  async search(query: string, viewerIsOwner: boolean) {
    const visibleModeration = viewerIsOwner
      ? {}
      : { moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] } };

    const [users, posts, ideas] = await Promise.all([
      this.prisma.user.findMany({
        where: { displayName: { contains: query, mode: 'insensitive' } },
        select: { id: true, memberNumber: true, displayName: true, avatarUrl: true, role: true },
        orderBy: { memberNumber: 'asc' },
        take: RESULT_LIMIT,
      }),
      this.prisma.post.findMany({
        where: {
          body: { contains: query, mode: 'insensitive' },
          publishedAt: { not: null },
          ...visibleModeration,
        },
        include: { author: true },
        orderBy: { publishedAt: 'desc' },
        take: RESULT_LIMIT,
      }),
      this.prisma.idea.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
          ...visibleModeration,
        },
        orderBy: { voteCount: 'desc' },
        take: RESULT_LIMIT,
      }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        memberNumber: u.memberNumber,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        role: u.role,
      })),
      posts: posts.map((p) => ({
        id: p.id,
        body: p.body,
        author: { id: p.author.id, displayName: p.author.displayName, avatarUrl: p.author.avatarUrl },
      })),
      ideas: ideas.map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        status: i.status,
      })),
    };
  }
}
