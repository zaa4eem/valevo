import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function serializePost(post: any) {
  return {
    id: post.id,
    body: post.body,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    author: {
      id: post.author.id,
      displayName: post.author.displayName,
      avatarUrl: post.author.avatarUrl,
    },
  };
}

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublished(limit = 30) {
    const posts = await this.prisma.post.findMany({
      where: { publishedAt: { not: null } },
      include: { author: true },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
    return posts.map(serializePost);
  }

  async create(authorId: string, body: string, publish: boolean) {
    const post = await this.prisma.post.create({
      data: { authorId, body, publishedAt: publish ? new Date() : null },
      include: { author: true },
    });
    return serializePost(post);
  }

  async update(id: string, data: { body?: string; publish?: boolean }) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found');

    const post = await this.prisma.post.update({
      where: { id },
      data: {
        body: data.body,
        publishedAt:
          data.publish === undefined
            ? undefined
            : data.publish
              ? (existing.publishedAt ?? new Date())
              : null,
      },
      include: { author: true },
    });
    return serializePost(post);
  }

  async delete(id: string) {
    await this.prisma.post.delete({ where: { id } });
  }
}
