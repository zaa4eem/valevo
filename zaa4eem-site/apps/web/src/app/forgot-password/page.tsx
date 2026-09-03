'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api-client';
import { Card } from '@/components/Card';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить запрос');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      <Card>
        <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-xl)' }}>Восстановление пароля</h1>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
          Укажите почту, с которой регистрировались — пришлём ссылку для сброса пароля.
        </p>

        {message ? (
          <p style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>{message}</p>
        ) : (
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="z-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
            <button type="submit" className="z-btn-accent" disabled={submitting || !email}>
              {submitting ? 'Отправка…' : 'Отправить ссылку'}
            </button>
          </form>
        )}

        <Link
          href="/login"
          style={{ display: 'block', marginTop: 16, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center' }}
        >
          Вернуться ко входу
        </Link>
      </Card>
    </div>
  );
}
