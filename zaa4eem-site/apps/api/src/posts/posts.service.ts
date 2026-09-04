import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModerationState } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';

const POST_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function serializePost(post: any, viewerId?: string, followingIds?: Set<string>) {
  return {
    id: post.id,
    body: post.body,
    imageUrl: post.imageUrl ?? null,
    moderationState: post.moderationState,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    author: {
      id: post.author.id,
      memberNumber: post.author.memberNumber,
      displayName: post.author.displayName,
      avatarUrl: post.author.avatarUrl,
      role: post.author.role,
      viewerIsFollowing: viewerId ? Boolean(followingIds?.has(post.author.id)) : undefined,
      isPremium: post.author.isPremium,
      nameStyle: post.author.nameStyle,
      nameColor: post.author.nameColor,
      ringStyle: post.author.ringStyle,
      badgeEmoji: post.author.badgeEmoji,
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
      isPremium: comment.author.isPremium,
      nameStyle: comment.author.nameStyle,
      nameColor: comment.author.nameColor,
      ringStyle: comment.author.ringStyle,
      badgeEmoji: comment.author.badgeEmoji,
    },
  };
}

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly notify: TelegramNotifyService,
  ) {}

  async listPublished(opts: {
    viewerId?: string;
    viewerIsOwner: boolean;
    cursor?: string;
    limit?: number;
  }) {
    const limit = opts.limit ?? 20;
    // The owner sees every post regardless of moderation state. Everyone else
    // sees only CLEAN/APPROVED posts by other people — but a signed-in
    // viewer's *own* post stays visible to them no matter its moderation
    // state, so posting something that lands in PENDING_REVIEW (e.g. it has
    // an image, see PostsService.create) doesn't just vanish from the
    // poster's own feed; it still shows the "на проверке" state instead.
    const where = opts.viewerIsOwner
      ? { publishedAt: { not: null } }
      : opts.viewerId
        ? {
            publishedAt: { not: null },
            OR: [
              { moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] } },
              { authorId: opts.viewerId },
            ],
          }
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
  async create(
    authorId: string,
    body: string,
    publish: boolean,
    isOwner: boolean,
    imageUrl?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (!isOwner) {
        // A Postgres advisory lock keyed on the author, held for the rest of
        // this transaction — without it, two concurrent create() calls from
        // the same author could both read "no recent post" before either
        // commits, bypassing the cooldown entirely. The second caller blocks
        // here until the first's transaction finishes, then sees its post.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${authorId}))`;

        const last = await tx.post.findFirst({
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

      // The banned-words classifier (this.moderation.classify) only ever reads
      // the caption text — it cannot inspect image content at all. So a post
      // with an image is *always* forced into PENDING_REVIEW for a human
      // (owner) review, regardless of how clean the caption is, rather than
      // trusting a text-only filter to vouch for a picture it never looked at.
      // This is a hard legal/moderation requirement (152-FZ/436-FZ content
      // review), not a heuristic — don't let a CLEAN caption override it.
      const moderationState = imageUrl ? ModerationState.PENDING_REVIEW : this.moderation.classify(body);
      const post = await tx.post.create({
        data: {
          authorId,
          body,
          imageUrl,
          moderationState,
          // Non-owners always publish immediately — the draft/schedule workflow
          // (publish: false) stays an owner-only tool.
          publishedAt: isOwner ? (publish ? new Date() : null) : new Date(),
        },
        include: { author: true, _count: { select: { likes: true, comments: true } } },
      });
      return serializePost(post, authorId);
    });
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

  async setModeration(postId: string, moderationState: ModerationState, actorId: string, reason?: string) {
    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { moderationState },
      include: { author: true, _count: { select: { likes: true, comments: true } } },
    });
    await this.prisma.moderationLogEntry.create({
      data: {
        actorId,
        targetType: 'POST',
        targetId: postId,
        action: `moderation:${moderationState}`,
        reason,
      },
    });
    return serializePost(post);
  }

  async getAuthorId(id: string): Promise<string | null> {
    const post = await this.prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    return post?.authorId ?? null;
  }

  async like(postId: string, userId: string) {
    const post = await this.assertVisible(postId);
    try {
      await this.prisma.like.create({ data: { postId, userId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Вы уже лайкнули этот пост');
      }
      throw err;
    }
    if (post.authorId !== userId) {
      this.notifyLike(post.authorId, userId).catch(() => undefined);
    }
  }

  private async notifyLike(authorId: string, likerId: string) {
    const [author, liker] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: authorId }, select: { telegramId: true } }),
      this.prisma.user.findUnique({ where: { id: likerId }, select: { displayName: true } }),
    ]);
    if (author?.telegramId && liker) {
      await this.notify.notify(author.telegramId, `🤍 ${liker.displayName} лайкнул(а) ваш пост`);
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
    const post = await this.assertVisible(postId);
    const moderationState = this.moderation.classify(body);
    const comment = await this.prisma.comment.create({
      data: { postId, authorId, body, moderationState },
      include: { author: true },
    });
    if (post.authorId !== authorId) {
      this.notifyComment(post.authorId, comment.author.displayName, body).catch(() => undefined);
    }
    return serializeComment(comment);
  }

  private async notifyComment(postAuthorId: string, commenterName: string, body: string) {
    const author = await this.prisma.user.findUnique({
      where: { id: postAuthorId },
      select: { telegramId: true },
    });
    if (author?.telegramId) {
      const preview = body.length > 200 ? `${body.slice(0, 200)}…` : body;
      await this.notify.notify(author.telegramId, `💬 ${commenterName} прокомментировал(а) ваш пост:\n«${preview}»`);
    }
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
    return post;
  }
}
