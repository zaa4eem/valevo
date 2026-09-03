import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModerationState } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';

const POST_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function serializePost(post: any, viewerId?: string, followingIds?: Set<string>) {
  return {
    id: post.id,
    body: post.body,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    author: {
      id: post.author.id,
      memberNumber: post.author.memberNumber,
      displayName: post.author.displayName,
      avatarUrl: post.author.avatarUrl,
      role: post.author.role,
      viewerIsFollowing: viewerId ? Boolean(followingIds?.has(post.author.id)) : undefined,
    },
    likeCount: post._count?.likes ?? 0,
    commentCount: post._count?.comments ?? 0,
    viewerHasLiked: viewerId ? (post.likes?.length ?? 0) > 0 : undefined,
  };
}

function serializeComment(comment: any) {
  return {
    id: comment.id,
    postId: comment.postId,
    body: comment.body,
    moderationState: comment.moderationState,
    createdAt: comment.createdAt.toISOString(),
    author: {
      id: comment.author.id,
      memberNumber: comment.author.memberNumber,
      displayName: comment.author.displayName,
      avatarUrl: comment.author.avatarUrl,
    },
  };
}

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  async listPublished(opts: {
    viewerId?: string;
    viewerIsOwner: boolean;
    cursor?: string;
    limit?: number;
  }) {
    const limit = opts.limit ?? 20;
    const where = opts.viewerIsOwner
      ? { publishedAt: { not: null } }
      : {
          publishedAt: { not: null },
          moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] },
        };

    const posts = await this.prisma.post.findMany({
      where,
      include: {
        author: true,
        _count: { select: { likes: true, comments: true } },
        likes: opts.viewerId ? { where: { userId: opts.viewerId } } : false,
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, limit) : posts;

    // One batched query for every author on the page instead of an N+1
    // per-post follow lookup.
    let followingIds: Set<string> | undefined;
    if (opts.viewerId) {
      const authorIds = [...new Set(items.map((post) => post.authorId))];
      const follows = await this.prisma.follow.findMany({
        where: { followerId: opts.viewerId, followingId: { in: authorIds } },
        select: { followingId: true },
      });
      followingIds = new Set(follows.map((f) => f.followingId));
    }

    return {
      items: items.map((post) => serializePost(post, opts.viewerId, followingIds)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /** Owners may post any time; everyone else is limited to one post per 12h (FR: v1.0.1). */
  async create(authorId: string, body: string, publish: boolean, isOwner: boolean) {
    if (!isOwner) {
      const last = await this.prisma.post.findFirst({
        where: { authorId },
        orderBy: { createdAt: 'desc' },
      });
      if (last) {
        const elapsed = Date.now() - last.createdAt.getTime();
        if (elapsed < POST_COOLDOWN_MS) {
          const minutesLeft = Math.ceil((POST_COOLDOWN_MS - elapsed) / 60_000);
          throw new ForbiddenException(
            `Следующий пост можно опубликовать через ${minutesLeft} мин.`,
          );
        }
      }
    }

    const moderationState = this.moderation.classify(body);
    const post = await this.prisma.post.create({
      data: {
        authorId,
        body,
        moderationState,
        // Non-owners always publish immediately — the draft/schedule workflow
        // (publish: false) stays an owner-only tool.
        publishedAt: isOwner ? (publish ? new Date() : null) : new Date(),
      },
      include: { author: true, _count: { select: { likes: true, comments: true } } },
    });
    return serializePost(post, authorId);
  }

  async update(id: string, data: { body?: string; publish?: boolean }) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Пост не найден');

    const post = await this.prisma.post.update({
      where: { id },
      data: {
        body: data.body,
        moderationState: data.body ? this.moderation.classify(data.body) : undefined,
        publishedAt:
          data.publish === undefined
            ? undefined
            : data.publish
              ? (existing.publishedAt ?? new Date())
              : null,
      },
      include: { author: true, _count: { select: { likes: true, comments: true } } },
    });
    return serializePost(post);
  }

  async delete(id: string) {
    await this.prisma.post.delete({ where: { id } });
  }

  async getAuthorId(id: string): Promise<string | null> {
    const post = await this.prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    return post?.authorId ?? null;
  }

  async like(postId: string, userId: string) {
    await this.assertVisible(postId);
    try {
      await this.prisma.like.create({ data: { postId, userId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Вы уже лайкнули этот пост');
      }
      throw err;
    }
  }

  async unlike(postId: string, userId: string) {
    await this.prisma.like.deleteMany({ where: { postId, userId } });
  }

  async listComments(postId: string, opts: { viewerIsOwner: boolean }) {
    const where = opts.viewerIsOwner
      ? { postId }
      : { postId, moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] } };

    const comments = await this.prisma.comment.findMany({
      where,
      include: { author: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return comments.map(serializeComment);
  }

  async createComment(postId: string, authorId: string, body: string) {
    await this.assertVisible(postId);
    const moderationState = this.moderation.classify(body);
    const comment = await this.prisma.comment.create({
      data: { postId, authorId, body, moderationState },
      include: { author: true },
    });
    return serializeComment(comment);
  }

  async deleteComment(postId: string, commentId: string, actor: { id: string; isOwner: boolean }) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.postId !== postId) throw new NotFoundException('Комментарий не найден');
    if (!actor.isOwner && comment.authorId !== actor.id) {
      throw new ForbiddenException('Можно удалять только свои комментарии');
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
  }

  private async assertVisible(postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Пост не найден');
    if (post.moderationState === ModerationState.REMOVED) {
      throw new ForbiddenException('Этот пост недоступен');
    }
  }
}
