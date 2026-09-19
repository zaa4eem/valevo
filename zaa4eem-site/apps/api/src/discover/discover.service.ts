import { Injectable } from '@nestjs/common';
import { ModerationState, levelFromXp, plural, type Discover } from '@zaa4eem/shared';
import { PrismaService } from '../prisma/prisma.service';

/** How many of each kind the discover screen shows. */
const PEOPLE = 8;
const POSTS = 6;
const IDEAS = 6;
/** Fewer on a profile page — it's a footer block there, not the point of the screen. */
const SIMILAR_PEOPLE = 5;
/** "Trending" means recent, not all-time — an all-time list never changes and stops being worth opening. */
const TRENDING_WINDOW_DAYS = 14;

/** Bounds on the candidate queries, so this never turns into a full-table scan as the platform grows. */
const MAX_FOLLOWING_SCANNED = 500;
const MAX_EDGES_SCANNED = 1000;
const MAX_LIKES_SCANNED = 300;

/** Scores, highest first — the order decides what "reason" a person gets shown with. */
const SCORE_FRIEND_OF_FRIEND = 10;
const SCORE_LIKED_AUTHOR = 6;
const SCORE_POPULAR = 1;

type Candidate = { score: number; reason: string; bestSignal: number };

@Injectable()
export class DiscoverService {
  constructor(private readonly prisma: PrismaService) {}

  async get(viewerId: string | undefined, viewerIsOwner: boolean): Promise<Discover> {
    const [people, posts, ideas] = await Promise.all([
      this.suggestPeople(viewerId),
      this.trendingPosts(viewerIsOwner),
      this.trendingIdeas(viewerIsOwner),
    ]);
    return { people, posts, ideas };
  }

  /**
   * Who to follow.
   *
   * Three signals, strongest first: people followed by people you already
   * follow, authors of posts you liked, and simply the most-followed people
   * you aren't following yet. The last one is what a brand-new account with
   * no history gets, so the list is never empty.
   *
   * Scored in memory rather than SQL because every input query is bounded —
   * at this scale that is a handful of indexed reads and a map, and it keeps
   * the ranking readable enough to actually tune later.
   */
  private async suggestPeople(viewerId: string | undefined) {
    const candidates = new Map<string, Candidate>();
    const exclude = new Set<string>(viewerId ? [viewerId] : []);

    if (viewerId) {
      const following = await this.prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followingId: true },
        take: MAX_FOLLOWING_SCANNED,
      });
      const followingIds = following.map((f) => f.followingId);
      followingIds.forEach((id) => exclude.add(id));

      if (followingIds.length > 0) {
        const edges = await this.prisma.follow.findMany({
          where: { followerId: { in: followingIds } },
          select: { followingId: true },
          take: MAX_EDGES_SCANNED,
        });
        // The more of your people follow someone, the stronger the signal.
        const mutualCount = new Map<string, number>();
        for (const edge of edges) {
          mutualCount.set(edge.followingId, (mutualCount.get(edge.followingId) ?? 0) + 1);
        }
        for (const [id, count] of mutualCount) {
          add(candidates, id, SCORE_FRIEND_OF_FRIEND * count, reasonForMutuals(count));
        }
      }

      const likes = await this.prisma.like.findMany({
        where: { userId: viewerId },
        select: { post: { select: { authorId: true } } },
        orderBy: { createdAt: 'desc' },
        take: MAX_LIKES_SCANNED,
      });
      for (const like of likes) {
        add(candidates, like.post.authorId, SCORE_LIKED_AUTHOR, 'Вы лайкали посты этого автора');
      }
    }

    // Always mixed in: keeps the list full for a new account, and surfaces
    // people a regular is simply not following yet.
    const popular = await this.prisma.user.findMany({
      where: { status: { not: 'BANNED' } },
      orderBy: { followers: { _count: 'desc' } },
      select: { id: true },
      take: PEOPLE * 4,
    });
    for (const user of popular) {
      add(candidates, user.id, SCORE_POPULAR, 'Популярный автор');
    }

    return this.hydrate(candidates, exclude);
  }

  /**
   * "Похожие профили" for one person's page: who else the people following
   * *them* follow.
   *
   * Deliberately a different question from suggestPeople's — this one is
   * about the profile being looked at, not about the viewer, so it works
   * identically for a signed-out visitor. The viewer only narrows it: their
   * own account and the people they already follow drop out.
   */
  async similar(userId: string, viewerId: string | undefined) {
    const followers = await this.prisma.follow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
      take: MAX_FOLLOWING_SCANNED,
    });
    if (followers.length === 0) return [];

    const edges = await this.prisma.follow.findMany({
      where: { followerId: { in: followers.map((f) => f.followerId) } },
      select: { followingId: true },
      take: MAX_EDGES_SCANNED,
    });

    const audienceOverlap = new Map<string, number>();
    for (const edge of edges) {
      audienceOverlap.set(edge.followingId, (audienceOverlap.get(edge.followingId) ?? 0) + 1);
    }

    const candidates = new Map<string, Candidate>();
    for (const [id, count] of audienceOverlap) {
      add(candidates, id, SCORE_FRIEND_OF_FRIEND * count, reasonForAudience(count));
    }

    const exclude = new Set<string>([userId]);
    if (viewerId) {
      exclude.add(viewerId);
      const viewerFollowing = await this.prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followingId: true },
        take: MAX_FOLLOWING_SCANNED,
      });
      viewerFollowing.forEach((f) => exclude.add(f.followingId));
    }

    return this.hydrate(candidates, exclude, SIMILAR_PEOPLE);
  }

  /** Ranks the scored ids, then fetches the display data for the few that survive. */
  private async hydrate(candidates: Map<string, Candidate>, exclude: Set<string>, limit = PEOPLE) {
    const ranked = [...candidates.entries()]
      .filter(([id]) => !exclude.has(id))
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);
    if (ranked.length === 0) return [];

    const rows = await this.prisma.user.findMany({
      where: { id: { in: ranked.map(([id]) => id) }, status: { not: 'BANNED' } },
      include: { _count: { select: { followers: true } }, progress: { select: { xp: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    // Filtered before mapping rather than mapping to null and filtering
    // after — the latter fights the return type for no benefit.
    return ranked
      .filter(([id]) => byId.has(id))
      .map(([id, candidate]) => {
        const row = byId.get(id) as NonNullable<ReturnType<typeof byId.get>>;
        return {
          id: row.id,
          displayName: row.displayName,
          avatarUrl: row.avatarUrl,
          memberNumber: row.memberNumber,
          role: row.role,
          isPremium: row.isPremium,
          nameStyle: row.nameStyle,
          nameColor: row.nameColor,
          ringStyle: row.ringStyle,
          nameFont: row.nameFont,
          badgeEmoji: row.badgeEmoji,
          followerCount: row._count.followers,
          reason: candidate.reason,
          level: levelFromXp(row.progress?.xp ?? 0),
        };
      });
  }

  private async trendingPosts(viewerIsOwner: boolean) {
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.post.findMany({
      where: {
        publishedAt: { not: null, gte: since },
        ...(viewerIsOwner
          ? {}
          : { moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] } }),
      },
      include: { author: true, _count: { select: { likes: true, comments: true } } },
      orderBy: [{ likes: { _count: 'desc' } }, { publishedAt: 'desc' }],
      take: POSTS,
    });

    return rows.map((post) => ({
      id: post.id,
      body: post.body,
      imageUrl: post.imageUrl,
      likeCount: post._count.likes,
      commentCount: post._count.comments,
      author: {
        id: post.author.id,
        displayName: post.author.displayName,
        avatarUrl: post.author.avatarUrl,
      },
    }));
  }

  private async trendingIdeas(viewerIsOwner: boolean) {
    const rows = await this.prisma.idea.findMany({
      where: {
        // A rejected idea is not something to invite people to vote on.
        status: { not: 'DECLINED' },
        ...(viewerIsOwner
          ? {}
          : { moderationState: { in: [ModerationState.CLEAN, ModerationState.APPROVED] } }),
      },
      orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }],
      take: IDEAS,
    });

    return rows.map((idea) => ({
      id: idea.id,
      title: idea.title,
      description: idea.description,
      status: idea.status,
      voteCount: idea.voteCount,
    }));
  }
}

/**
 * Signals stack, but only the strongest one gets to explain itself.
 *
 * Tracking `bestSignal` separately from the running total is what makes that
 * true regardless of the order the signals are collected in — comparing a new
 * signal against the accumulated score would let "Популярный автор" stick to
 * someone three of your friends follow, just because it was added first.
 */
function add(map: Map<string, Candidate>, id: string, score: number, reason: string) {
  const existing = map.get(id);
  if (!existing) {
    map.set(id, { score, reason, bestSignal: score });
    return;
  }
  existing.score += score;
  if (score > existing.bestSignal) {
    existing.bestSignal = score;
    existing.reason = reason;
  }
}

/**
 * Phrased around "профиль", not around the person.
 *
 * "На него подписан кто-то из ваших" is simply wrong next to a woman's
 * name, and nothing here knows anyone's gender — so the sentence is built
 * so that it never needs to.
 */
function reasonForMutuals(count: number): string {
  if (count === 1) return 'На этот профиль подписан кто-то из ваших';
  return `На этот профиль подписаны ${count} из ваших`;
}

/**
 * "Читатель", not "подписчик", on purpose: this line sits next to the
 * person's own follower count, and "3 общих подписчика · 4 подписчика"
 * reads as one number contradicting the other.
 */
function reasonForAudience(count: number): string {
  return `${count} ${plural(count, 'общий читатель', 'общих читателя', 'общих читателей')}`;
}
