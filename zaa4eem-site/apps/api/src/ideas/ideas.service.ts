import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdeaStatus, ModerationState } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { TelegramNotifyService } from '../common/telegram-notify.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProgressService } from '../progress/progress.service';

const IDEA_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новая',
  UNDER_REVIEW: 'На рассмотрении',
  ACCEPTED: 'Принята',
  IN_PROGRESS: 'В разработке',
  SHIPPED: 'Готово',
  DECLINED: 'Отклонена',
};

function serializeIdea(idea: any, viewerId?: string) {
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description,
    status: idea.status,
    moderationState: idea.moderationState,
    voteCount: idea.voteCount,
    createdAt: idea.createdAt.toISOString(),
    submitter: {
      id: idea.submitter.id,
      displayName: idea.submitter.displayName,
      avatarUrl: idea.submitter.avatarUrl,
    },
    viewerHasVoted: viewerId ? idea.votes?.some((v: any) => v.userId === viewerId) : undefined,
  };
}

@Injectable()
export class IdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly notify: TelegramNotifyService,
    private readonly notifications: NotificationsService,
    private readonly progress: ProgressService,
  ) {}

  async create(submitterId: string, title: string, description: string) {
    const moderationState = this.moderation.classify(`${title}\n${description}`);
    const idea = await this.prisma.idea.create({
      data: { submitterId, title, description, moderationState },
      include: { submitter: true },
    });
    this.progress.record(submitterId, 'IDEA_SUBMITTED').catch(() => undefined);
    return serializeIdea(idea);
  }

  /**
   * Non-owners only ever see CLEAN/APPROVED ideas; the owner sees everything
   * (including PENDING_REVIEW) so they can moderate from the same board if
   * they choose, though the dedicated admin queue is the primary workflow.
   */
  async list(opts: {
    sort: 'top' | 'new';
    viewerId?: string;
    viewerIsOwner: boolean;
    cursor?: string;
    limit?: number;
  }) {
    const limit = opts.limit ?? 20;
    const where = opts.viewerIsOwner
      ? {}
      : { moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] } };

    const ideas = await this.prisma.idea.findMany({
      where,
      include: { submitter: true, votes: opts.viewerId ? true : false },
      orderBy:
        opts.sort === 'top'
          ? [{ voteCount: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = ideas.length > limit;
    const items = hasMore ? ideas.slice(0, limit) : ideas;
    return {
      items: items.map((idea) => serializeIdea(idea, opts.viewerId)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getById(id: string, viewerId?: string) {
    const idea = await this.prisma.idea.findUnique({
      where: { id },
      include: { submitter: true, votes: viewerId ? true : false },
    });
    if (!idea) throw new NotFoundException('Идея не найдена');
    return serializeIdea(idea, viewerId);
  }

  async vote(ideaId: string, userId: string) {
    await this.assertVisible(ideaId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.vote.create({ data: { ideaId, userId } });
        await tx.idea.update({ where: { id: ideaId }, data: { voteCount: { increment: 1 } } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Вы уже голосовали за эту идею');
      }
      throw err;
    }
    this.progress.record(userId, 'IDEA_VOTED').catch(() => undefined);
  }

  async unvote(ideaId: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.vote.deleteMany({ where: { ideaId, userId } });
      if (deleted.count > 0) {
        await tx.idea.update({ where: { id: ideaId }, data: { voteCount: { decrement: 1 } } });
      }
    });
  }

  async setStatus(ideaId: string, status: IdeaStatus, actorId: string, reason?: string) {
    const idea = await this.prisma.idea.update({
      where: { id: ideaId },
      data: { status },
      include: { submitter: true },
    });
    await this.prisma.moderationLogEntry.create({
      data: {
        actorId,
        targetType: 'IDEA',
        targetId: ideaId,
        action: `status:${status}`,
        reason,
      },
    });
    // ACCEPTED is the one status that pays the author — it's the moment
    // their idea became part of the project, and the only status the
    // "Соавтор" achievements are measured against.
    if (status === IdeaStatus.ACCEPTED) {
      this.progress.record(idea.submitterId, 'IDEA_ACCEPTED').catch(() => undefined);
    }
    const label = IDEA_STATUS_LABELS[status] ?? status;
    this.notifications
      .create({
        userId: idea.submitterId,
        type: 'IDEA_STATUS_CHANGED',
        actorId: actorId === idea.submitterId ? null : actorId,
        targetType: 'IDEA',
        targetId: ideaId,
        body: `Статус вашей идеи «${idea.title}» изменён: ${label}`,
        telegramText: `💡 Статус вашей идеи «${idea.title}» изменён: ${label}`,
      })
      .catch(() => undefined);
    return serializeIdea(idea);
  }

  async setModeration(
    ideaId: string,
    moderationState: ModerationState,
    actorId: string,
    reason?: string,
  ) {
    const idea = await this.prisma.idea.update({
      where: { id: ideaId },
      data: { moderationState },
      include: { submitter: true },
    });
    await this.prisma.moderationLogEntry.create({
      data: {
        actorId,
        targetType: 'IDEA',
        targetId: ideaId,
        action: `moderation:${moderationState}`,
        reason,
      },
    });
    return serializeIdea(idea);
  }

  private async assertVisible(ideaId: string) {
    const idea = await this.prisma.idea.findUnique({ where: { id: ideaId } });
    if (!idea) throw new NotFoundException('Идея не найдена');
    if (idea.moderationState === ModerationState.REMOVED) {
      throw new ForbiddenException('Эта идея недоступна');
    }
  }
}
