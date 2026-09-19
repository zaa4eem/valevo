import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ScrollStatus } from '@prisma/client';
import * as path from 'path';
import type {
  CreateScrollCommentInput,
  ScrollFeedQuery,
} from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TranscodeService, VideoRejected, safeUnlink } from './transcode.service';
import { SCROLLS_DIR } from './video-storage';

const COMMENTS_PAGE = 50;

/** Public URL for a file that transcoding wrote into the scrolls directory. */
function publicUrl(filePath: string) {
  return `/uploads/scrolls/${path.basename(filePath)}`;
}

@Injectable()
export class ScrollsService {
  private readonly logger = new Logger(ScrollsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transcode: TranscodeService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Takes the raw upload and returns immediately.
   *
   * Transcoding a 90-second clip takes tens of seconds; holding the request
   * open for it would time out on a phone on mobile data, which is exactly
   * where these uploads come from. The row exists from the first moment in
   * PROCESSING, so the uploader can watch its state change instead of
   * wondering whether anything happened.
   */
  async createFromUpload(userId: string, rawPath: string, caption: string) {
    const scroll = await this.prisma.scroll.create({
      data: { authorId: userId, caption: caption.trim(), status: ScrollStatus.PROCESSING },
    });

    void this.processInBackground(scroll.id, rawPath);
    return { id: scroll.id, status: scroll.status as string };
  }

  private async processInBackground(scrollId: string, rawPath: string) {
    try {
      const result = await this.transcode.transcode(rawPath);
      await this.prisma.scroll.update({
        where: { id: scrollId },
        data: {
          videoUrl: publicUrl(result.videoPath),
          posterUrl: publicUrl(result.posterPath),
          durationMs: result.durationMs,
          width: result.width,
          height: result.height,
          // Never straight to PUBLISHED. Every clip is watched by a person
          // first — that is the rule this whole feature is built around.
          status: ScrollStatus.PENDING_REVIEW,
        },
      });
    } catch (err) {
      const reason = err instanceof VideoRejected ? err.message : 'Не удалось обработать видео';
      if (!(err instanceof VideoRejected)) {
        this.logger.error(`Transcode crashed for ${scrollId}: ${err instanceof Error ? err.message : err}`);
      }
      await this.prisma.scroll
        .update({ where: { id: scrollId }, data: { status: ScrollStatus.FAILED, rejectionReason: reason } })
        .catch(() => undefined);
    } finally {
      // The original upload is never kept: it has served its purpose, it is
      // the largest file in the pipeline, and it is the one nobody has
      // looked at yet.
      await safeUnlink(rawPath);
    }
  }

  /** The feed: published clips, newest first. */
  async feed(query: ScrollFeedQuery, viewerId: string | undefined) {
    const rows = await this.prisma.scroll.findMany({
      where: { status: ScrollStatus.PUBLISHED },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: this.include(viewerId),
    });

    const items = rows.slice(0, query.limit);
    return {
      items: items.map((row) => this.toScroll(row, viewerId)),
      nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
    };
  }

  /** Everything you uploaded, including what nobody else can see yet. */
  async mine(userId: string) {
    const rows = await this.prisma.scroll.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      include: this.include(userId),
    });
    return rows.map((row) => ({
      ...this.toScroll(row, userId),
      status: row.status as string,
      rejectionReason: row.rejectionReason,
    }));
  }

  async like(scrollId: string, userId: string) {
    const scroll = await this.published(scrollId);
    await this.prisma.scrollLike.upsert({
      where: { scrollId_userId: { scrollId, userId } },
      create: { scrollId, userId },
      update: {},
    });
    if (scroll.authorId !== userId) {
      const liker = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      void this.notifications.create({
        userId: scroll.authorId,
        type: 'POST_LIKED',
        body: `${liker?.displayName ?? 'Кто-то'} лайкнул ваш Scroll`,
        actorId: userId,
        href: `/scrolls?clip=${scrollId}`,
      });
    }
    return this.one(scrollId, userId);
  }

  async unlike(scrollId: string, userId: string) {
    await this.prisma.scrollLike.deleteMany({ where: { scrollId, userId } });
    return this.one(scrollId, userId);
  }

  async comments(scrollId: string) {
    await this.published(scrollId);
    const rows = await this.prisma.scrollComment.findMany({
      where: { scrollId },
      orderBy: { createdAt: 'desc' },
      take: COMMENTS_PAGE,
      include: { user: true },
    });
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: {
        id: row.user.id,
        displayName: row.user.displayName,
        avatarUrl: row.user.avatarUrl,
        isPremium: row.user.isPremium,
        nameStyle: row.user.nameStyle,
        nameColor: row.user.nameColor,
        ringStyle: row.user.ringStyle,
        nameFont: row.user.nameFont,
        badgeEmoji: row.user.badgeEmoji,
      },
    }));
  }

  async comment(scrollId: string, userId: string, input: CreateScrollCommentInput) {
    const scroll = await this.published(scrollId);
    await this.prisma.scrollComment.create({ data: { scrollId, userId, body: input.body.trim() } });
    void this.progress.record(userId, 'COMMENT_WRITTEN');
    if (scroll.authorId !== userId) {
      const author = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      void this.notifications.create({
        userId: scroll.authorId,
        type: 'POST_COMMENTED',
        body: `${author?.displayName ?? 'Кто-то'} прокомментировал ваш Scroll`,
        actorId: userId,
        href: `/scrolls?clip=${scrollId}`,
      });
    }
    return this.comments(scrollId);
  }

  /** Counts a view. Deliberately not deduplicated — see the controller's throttle. */
  async view(scrollId: string) {
    await this.prisma.scroll.updateMany({
      where: { id: scrollId, status: ScrollStatus.PUBLISHED },
      data: { viewCount: { increment: 1 } },
    });
  }

  async remove(scrollId: string, userId: string, viewerIsOwner: boolean) {
    const scroll = await this.prisma.scroll.findUnique({ where: { id: scrollId } });
    if (!scroll) throw new NotFoundException('Ролик не найден');
    if (scroll.authorId !== userId && !viewerIsOwner) {
      throw new ForbiddenException('Это не ваш ролик');
    }
    await this.prisma.scroll.delete({ where: { id: scrollId } });
    // Files are removed after the row, not before: a failed delete leaving
    // an orphaned file is a wasted megabyte, while the reverse is a feed
    // entry pointing at nothing.
    for (const url of [scroll.videoUrl, scroll.posterUrl]) {
      if (url) await safeUnlink(path.join(SCROLLS_DIR, path.basename(url)));
    }
  }

  // --- Moderation --------------------------------------------------------

  async pending() {
    const rows = await this.prisma.scroll.findMany({
      where: { status: { in: [ScrollStatus.PENDING_REVIEW, ScrollStatus.PROCESSING] } },
      orderBy: { createdAt: 'asc' },
      include: this.include(undefined),
    });
    return rows.map((row) => ({
      ...this.toScroll(row, undefined),
      status: row.status as string,
      rejectionReason: row.rejectionReason,
      authorEmail: row.author.email,
    }));
  }

  async review(scrollId: string, moderatorId: string, approve: boolean, reason?: string) {
    const scroll = await this.prisma.scroll.findUnique({ where: { id: scrollId } });
    if (!scroll) throw new NotFoundException('Ролик не найден');
    if (scroll.status === ScrollStatus.PROCESSING) {
      throw new BadRequestException('Видео ещё обрабатывается — подождите, пока появится обложка');
    }

    const updated = await this.prisma.scroll.update({
      where: { id: scrollId },
      data: {
        status: approve ? ScrollStatus.PUBLISHED : ScrollStatus.REJECTED,
        rejectionReason: approve ? null : (reason?.trim() || 'Не прошло модерацию'),
        reviewedById: moderatorId,
        reviewedAt: new Date(),
        // Set on approval, so the feed's ordering is "when it became
        // visible", not "when it was uploaded" — a clip that waited a day
        // in the queue still arrives at the top.
        publishedAt: approve ? new Date() : null,
      },
    });

    void this.notifications.create({
      userId: scroll.authorId,
      type: 'SYSTEM',
      body: approve
        ? 'Ваш Scroll прошёл модерацию и опубликован'
        : `Ваш Scroll отклонён: ${updated.rejectionReason}`,
      href: approve ? `/scrolls?clip=${scrollId}` : '/scrolls/mine',
    });
    if (approve) void this.progress.record(scroll.authorId, 'POST_PUBLISHED');

    return { id: updated.id, status: updated.status as string };
  }

  // --- Shared helpers ----------------------------------------------------

  /**
   * The viewer's own like and follow, fetched as filtered relations rather
   * than as separate queries per clip — `likes` here is "this viewer's
   * like, if any", at most one row, not the whole list.
   */
  private include(viewerId: string | undefined) {
    return {
      _count: { select: { likes: true, comments: true } },
      likes: viewerId ? { where: { userId: viewerId }, select: { userId: true } } : false,
      author: viewerId
        ? { include: { followers: { where: { followerId: viewerId }, select: { followerId: true } } } }
        : true,
    } as const;
  }

  private async published(scrollId: string) {
    const scroll = await this.prisma.scroll.findUnique({ where: { id: scrollId } });
    if (!scroll || scroll.status !== ScrollStatus.PUBLISHED) throw new NotFoundException('Ролик не найден');
    return scroll;
  }

  private async one(scrollId: string, viewerId: string | undefined) {
    const row = await this.prisma.scroll.findUnique({
      where: { id: scrollId },
      include: this.include(viewerId),
    });
    if (!row) throw new NotFoundException('Ролик не найден');
    return this.toScroll(row, viewerId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toScroll(row: any, viewerId: string | undefined) {
    return {
      id: row.id,
      videoUrl: row.videoUrl,
      posterUrl: row.posterUrl,
      caption: row.caption,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      viewCount: row.viewCount,
      likeCount: row._count.likes,
      commentCount: row._count.comments,
      viewerHasLiked: Boolean(viewerId && row.likes?.length),
      createdAt: row.createdAt.toISOString(),
      author: {
        id: row.author.id,
        displayName: row.author.displayName,
        avatarUrl: row.author.avatarUrl,
        viewerIsFollowing: Boolean(viewerId && row.author.followers?.length),
        isPremium: row.author.isPremium,
        nameStyle: row.author.nameStyle,
        nameColor: row.author.nameColor,
        ringStyle: row.author.ringStyle,
        nameFont: row.author.nameFont,
        badgeEmoji: row.author.badgeEmoji,
      },
    };
  }
}
