'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  SCROLL_MAX_BYTES,
  SCROLL_MAX_CAPTION,
  SCROLL_MAX_DURATION_S,
} from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';
import { Card } from '@/components/Card';

const MAX_MB = Math.round(SCROLL_MAX_BYTES / (1024 * 1024));

export default function ScrollUploadPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setError(null);
    setDuration(null);
    // Checked here purely so the person finds out before spending their
    // upload allowance and their mobile data. The server checks again, and
    // the server's answer is the one that counts.
    if (chosen.size > SCROLL_MAX_BYTES) {
      setError(`Файл больше ${MAX_MB} МБ — выберите ролик покороче`);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
  }

  function onLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const seconds = e.currentTarget.duration;
    if (!Number.isFinite(seconds)) return;
    setDuration(seconds);
    if (seconds > SCROLL_MAX_DURATION_S) {
      setError(`Ролик длиннее ${SCROLL_MAX_DURATION_S} секунд — обрежьте его перед загрузкой`);
    }
  }

  function clear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setDuration(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    if (duration !== null && duration > SCROLL_MAX_DURATION_S) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('video', file);
      form.append('caption', caption);
      await api.upload('/scrolls', form);
      toast('Отправлено на модерацию — ролик появится после проверки', 'success');
      router.push('/scrolls/mine');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить ролик');
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <Card style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--z-text-muted)' }}>Чтобы загружать ролики, нужно войти.</p>
          <Link href="/login" className="z-btn-accent z-pop-on-active">
            Войти
          </Link>
        </Card>
      </div>
    );
  }

  const tooLong = duration !== null && duration > SCROLL_MAX_DURATION_S;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', marginTop: 0 }}>Новый Scroll</h1>

      <Card>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            ref={inputRef}
            type="file"
            // capture lets a phone offer the camera directly, not just the
            // gallery — most of these clips are shot on the spot.
            accept="video/mp4,video/quicktime,video/webm,video/*"
            onChange={pick}
            style={{ display: 'none' }}
          />

          {previewUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={previewUrl}
                controls
                playsInline
                onLoadedMetadata={onLoadedMetadata}
                style={{
                  width: '100%',
                  maxHeight: 420,
                  borderRadius: 'var(--z-radius-md)',
                  background: '#000',
                }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                <span>{(file!.size / (1024 * 1024)).toFixed(1)} МБ</span>
                {duration !== null && <span>{duration.toFixed(1)} сек</span>}
                <button
                  type="button"
                  onClick={clear}
                  className="z-btn-ghost z-pop-on-active"
                  style={{ marginLeft: 'auto', fontSize: 'var(--z-fs-xs)', padding: '4px 10px' }}
                >
                  Другой файл
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="z-pop-on-active"
              style={{
                border: '2px dashed var(--z-border)',
                borderRadius: 'var(--z-radius-md)',
                background: 'transparent',
                color: 'var(--z-text-muted)',
                padding: '36px 16px',
                cursor: 'pointer',
                fontSize: 'var(--z-fs-sm)',
              }}
            >
              <div style={{ fontSize: 34, marginBottom: 8 }}>🎬</div>
              Выбрать или снять видео
              <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginTop: 6 }}>
                До {SCROLL_MAX_DURATION_S} секунд, до {MAX_MB} МБ
              </div>
            </button>
          )}

          <div>
            <textarea
              className="z-input"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Подпись (необязательно)"
              maxLength={SCROLL_MAX_CAPTION}
              rows={2}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div style={{ textAlign: 'right', fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
              {caption.length}/{SCROLL_MAX_CAPTION}
            </div>
          </div>

          {error && <p style={{ color: 'var(--z-danger)', margin: 0, fontSize: 'var(--z-fs-sm)' }}>{error}</p>}

          <button type="submit" disabled={!file || busy || tooLong} className="z-btn-accent z-pop-on-active">
            {busy ? 'Загружаем…' : 'Отправить на модерацию'}
          </button>

          <p style={{ margin: 0, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
            Каждый ролик смотрит человек перед публикацией — обычно это недолго. Пока он на
            проверке, его видишь только ты, на странице «Мои».
          </p>
        </form>
      </Card>
    </div>
  );
}
