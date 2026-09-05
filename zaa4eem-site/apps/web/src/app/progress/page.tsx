'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ClaimReward, QuestState, ReferralGoalState } from '@zaa4eem/shared';
import { STREAK_MAX_MULTIPLIER } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useProgress } from '@/lib/progress-context';
import { Card } from '@/components/Card';
import { LevelBar } from '@/components/LevelBar';

export default function ProgressPage() {
  const { user, loading: authLoading } = useAuth();
  const { state, refresh } = useProgress();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function claim(path: string, key: string, describe: (r: ClaimReward) => string) {
    setClaiming(key);
    setError(null);
    try {
      const reward = await api.post<ClaimReward>(path);
      setToast(describe(reward));
      await refresh();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось получить награду');
    } finally {
      setClaiming(null);
    }
  }

  if (authLoading || (user && !state)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="z-skeleton" style={{ height: 130, borderRadius: 'var(--z-radius-md)' }} />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <Card className="z-animate-in" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
        <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>Прогресс</h1>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Войдите, чтобы копить опыт, держать серию и собирать достижения.
        </p>
        <Link href="/login" className="z-btn-accent z-pop-on-active" style={{ display: 'inline-block', marginTop: 8 }}>
          Войти
        </Link>
      </Card>
    );
  }

  if (!state) return null;

  const { streak, quests, season, referralGoals } = state;
  const questsDone = quests.filter((q) => q.claimed).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 'var(--z-fs-xl)' }}>Прогресс</h1>

      {toast && <div className="z-reward-toast z-animate-in">{toast}</div>}
      {error && (
        <Card style={{ borderColor: 'var(--z-danger)', color: 'var(--z-danger)' }}>{error}</Card>
      )}

      {/* Level + streak: the two numbers that describe "how far in am I" and
          "am I keeping it up", side by side because they answer together. */}
      <Card hover className="z-animate-in">
        <LevelBar level={state.level} />
        <div className="z-streak-row">
          <div className={`z-streak-badge${streak.countedToday ? ' z-streak-badge-lit' : ''}`}>
            <span style={{ fontSize: 26 }} aria-hidden>
              🔥
            </span>
            <span>
              <span style={{ display: 'block', fontWeight: 900, fontSize: 'var(--z-fs-lg)' }}>
                {streak.days} {plural(streak.days, 'день', 'дня', 'дней')}
              </span>
              <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)' }}>
                {streak.countedToday ? 'сегодня засчитан' : 'сегодня ещё не засчитан'}
              </span>
            </span>
          </div>

          <div className="z-streak-facts">
            <Fact label="Множитель Z-коинов" value={`×${streak.multiplier}`} hint={streak.multiplier >= STREAK_MAX_MULTIPLIER ? 'максимум' : 'растёт каждый день'} />
            <Fact label="Лучшая серия" value={`${streak.best}`} hint={plural(streak.best, 'день', 'дня', 'дней')} />
            {streak.nextMilestone && (
              <Fact
                label={`До «${streak.nextMilestone.label}»`}
                value={`${streak.nextMilestone.day - streak.days}`}
                hint={`+${streak.nextMilestone.coins} 🪙`}
              />
            )}
          </div>
        </div>
        {streak.freezeAvailable && (
          <div className="z-freeze-note">
            ❄️ Premium: один пропущенный день не сбросит серию
          </div>
        )}
      </Card>

      {/* Daily quests */}
      <Card hover className="z-animate-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--z-fs-lg)' }}>🎯 Задания на сегодня</h2>
          <span style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {questsDone} / {quests.length}
          </span>
        </div>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: 6, marginBottom: 14 }}>
          Обновятся завтра. Всё выполнимо за один заход.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {quests.map((quest) => (
            <QuestRow
              key={quest.code}
              quest={quest}
              busy={claiming === quest.code}
              onClaim={() =>
                claim(`/progress/quests/${quest.code}/claim`, quest.code, (r) => `+${r.coins} 🪙 и +${r.xp} XP`)
              }
            />
          ))}
        </div>
      </Card>

      {/* Season */}
      <Card hover className="z-animate-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--z-fs-lg)' }}>🏆 Сезон {season.index}</h2>
          <Link href="/leaderboard?tab=season" style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-accent)' }}>
            Таблица сезона →
          </Link>
        </div>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: 6, marginBottom: 14 }}>
          Каждые четыре недели счёт обнуляется — у всех одновременно, поэтому догнать можно всегда.
        </p>
        <div className="z-streak-facts">
          <Fact label="Ваш счёт" value={season.xp.toLocaleString('ru-RU')} hint="XP за сезон" />
          <Fact label="Место" value={season.rank ? `#${season.rank}` : '—'} hint={season.rank ? 'в сезоне' : 'заработайте XP'} />
          <Fact label="Осталось" value={`${season.daysLeft}`} hint={plural(season.daysLeft, 'день', 'дня', 'дней')} />
        </div>
      </Card>

      {/* Achievements teaser */}
      <Link href="/achievements" style={{ display: 'block' }}>
        <Card hover className="z-animate-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 'var(--z-fs-lg)' }}>🏅 Достижения</div>
              <div style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
                Собрано {state.achievementsUnlocked} из {state.achievementsTotal}
              </div>
            </div>
            <span style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-lg)' }} aria-hidden>
              →
            </span>
          </div>
          <div className="z-xp-track" style={{ marginTop: 12 }}>
            <div
              className="z-xp-fill"
              style={{ width: `${Math.max(2, (state.achievementsUnlocked / state.achievementsTotal) * 100)}%` }}
            />
          </div>
        </Card>
      </Link>

      {/* Referral goals */}
      <Card hover className="z-animate-in">
        <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>📨 Приглашения</h2>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -4, marginBottom: 14 }}>
          Ссылка для приглашений — в{' '}
          <Link href="/games/z-clicker" style={{ color: 'var(--z-accent)' }}>
            Z-Кликере
          </Link>
          . Каждая цель платит один раз.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {referralGoals.map((goal) => (
            <ReferralGoalRow
              key={goal.code}
              goal={goal}
              busy={claiming === goal.code}
              onClaim={() =>
                claim(`/progress/referral-goals/${goal.code}/claim`, goal.code, (r) =>
                  `+${r.coins} 🪙${r.premiumDays > 0 ? ` и Premium на ${r.premiumDays} дн.` : ''}`,
                )
              }
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="z-fact">
      <div className="z-fact-label">{label}</div>
      <div className="z-fact-value">{value}</div>
      <div className="z-fact-hint">{hint}</div>
    </div>
  );
}

function QuestRow({ quest, busy, onClaim }: { quest: QuestState; busy: boolean; onClaim: () => void }) {
  return (
    <div className={`z-quest${quest.claimed ? ' z-quest-claimed' : ''}`}>
      <span className="z-quest-icon" aria-hidden>
        {quest.claimed ? '✓' : quest.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{quest.title}</div>
        <div className="z-xp-track z-quest-track">
          <div
            className="z-xp-fill"
            style={{ width: `${Math.max(2, (quest.progress / quest.target) * 100)}%` }}
          />
        </div>
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {quest.progress} / {quest.target} · +{quest.coins} 🪙 · +{quest.xp} XP
        </div>
      </div>
      {quest.claimed ? (
        <span className="z-quest-done" aria-label="Награда получена">
          Получено
        </span>
      ) : quest.done ? (
        <button onClick={onClaim} disabled={busy} className="z-btn-accent z-pop-on-active" style={{ flexShrink: 0 }}>
          {busy ? '…' : 'Забрать'}
        </button>
      ) : (
        <Link href={quest.href} className="z-btn-ghost z-pop-on-active" style={{ flexShrink: 0 }}>
          Выполнить
        </Link>
      )}
    </div>
  );
}

function ReferralGoalRow({
  goal,
  busy,
  onClaim,
}: {
  goal: ReferralGoalState;
  busy: boolean;
  onClaim: () => void;
}) {
  return (
    <div className={`z-quest${goal.claimed ? ' z-quest-claimed' : ''}`}>
      <span className="z-quest-icon" aria-hidden>
        {goal.claimed ? '✓' : goal.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{goal.title}</div>
        <div className="z-xp-track z-quest-track">
          <div
            className="z-xp-fill"
            style={{ width: `${Math.max(2, (goal.progress / goal.invites) * 100)}%` }}
          />
        </div>
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {goal.progress} / {goal.invites} · +{goal.coins} 🪙
          {goal.premiumDays > 0 ? ` · Premium ${goal.premiumDays} дн.` : ''}
        </div>
      </div>
      {goal.claimed ? (
        <span className="z-quest-done">Получено</span>
      ) : goal.reached ? (
        <button onClick={onClaim} disabled={busy} className="z-btn-accent z-pop-on-active" style={{ flexShrink: 0 }}>
          {busy ? '…' : 'Забрать'}
        </button>
      ) : null}
    </div>
  );
}

/** Russian's three plural forms; 11-14 are the exceptions a plain `n % 10` gets wrong. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
