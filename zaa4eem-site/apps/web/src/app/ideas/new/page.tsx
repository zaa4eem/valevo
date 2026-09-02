'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdeaSchema } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';

export default function NewIdeaPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!authLoading && !user) {
    return (
      <Card>
        <p>Нужно войти, чтобы предложить идею.</p>
      </Card>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createIdeaSchema.safeParse({ title, description });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы');
      return;
    }

    setSubmitting(true);
    try {
      const idea = await api.post<{ id: string }>('/ideas', parsed.data);
      router.push(`/ideas/${idea.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить идею');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h1 style={{ marginTop: 0 }}>Предложить идею</h1>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label>
          <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
            Заголовок
          </div>
          <input
            className="z-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Например: тёмная тема для профиля"
          />
        </label>
        <label>
          <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
            Описание
          </div>
          <textarea
            className="z-textarea"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="Расскажи подробнее, что и зачем"
          />
        </label>
        {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
        <button type="submit" className="z-btn-accent" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
          {submitting ? 'Отправка…' : 'Отправить идею'}
        </button>
      </form>
    </Card>
  );
}
