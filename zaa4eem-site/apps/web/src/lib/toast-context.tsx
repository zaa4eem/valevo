'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  /** Present for a prompt: the dialog grows a text field and resolves with its value. */
  input?: { placeholder: string; required: boolean };
  resolve: (value: boolean | string | null) => void;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
  /**
   * Promise-based replacement for window.confirm. The native one blocks the
   * whole page, ignores the site's theme, and on iOS says "localhost says",
   * which reads like a browser error rather than a question from the app.
   */
  confirm: (
    message: string,
    options?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
  ) => Promise<boolean>;
  /**
   * Replacement for window.prompt, which several browsers now suppress
   * entirely and the rest render as a browser-chrome box that looks like a
   * security warning. Resolves to null when cancelled.
   */
  prompt: (
    message: string,
    options?: { placeholder?: string; confirmLabel?: string; required?: boolean },
  ) => Promise<string | null>;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => undefined,
  confirm: async () => false,
  prompt: async () => null,
});

const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [draft, setDraft] = useState('');
  const nextId = useRef(0);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = (nextId.current += 1);
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  const confirm = useCallback<ToastContextValue['confirm']>(
    (message, options) =>
      new Promise<boolean>((resolve) => {
        setRequest({
          message,
          confirmLabel: options?.confirmLabel ?? 'Да',
          cancelLabel: options?.cancelLabel ?? 'Отмена',
          danger: options?.danger ?? true,
          resolve: resolve as (value: boolean | string | null) => void,
        });
      }),
    [],
  );

  const prompt = useCallback<ToastContextValue['prompt']>(
    (message, options) =>
      new Promise<string | null>((resolve) => {
        setDraft('');
        setRequest({
          message,
          confirmLabel: options?.confirmLabel ?? 'Готово',
          cancelLabel: 'Отмена',
          danger: false,
          input: { placeholder: options?.placeholder ?? '', required: options?.required ?? true },
          resolve: resolve as (value: boolean | string | null) => void,
        });
      }),
    [],
  );

  function answer(ok: boolean) {
    if (!request) return;
    if (request.input) {
      request.resolve(ok ? draft.trim() : null);
    } else {
      request.resolve(ok);
    }
    setRequest(null);
    setDraft('');
  }

  const value = useMemo(() => ({ toast, confirm, prompt }), [toast, confirm, prompt]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* aria-live so a screen reader announces the toast without stealing focus. */}
      <div className="z-toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`z-toast z-toast-${t.kind}`}>
            <span aria-hidden>{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {request && (
        <div
          className="z-modal-backdrop"
          onClick={() => answer(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') answer(false);
          }}
        >
          <div
            className="z-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: '0 0 18px', fontSize: 'var(--z-fs-base)', lineHeight: 1.4 }}>
              {request.message}
            </p>
            {request.input && (
              <input
                className="z-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={request.input.placeholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (draft.trim() || !request.input?.required)) answer(true);
                }}
                style={{ width: '100%', marginBottom: 18 }}
              />
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => answer(false)} className="z-btn-ghost z-pop-on-active">
                {request.cancelLabel}
              </button>
              <button
                onClick={() => answer(true)}
                className="z-btn-accent z-pop-on-active"
                autoFocus={!request.input}
                disabled={Boolean(request.input?.required) && draft.trim().length === 0}
                style={
                  request.danger
                    ? { background: 'var(--z-danger)', color: '#fff', borderColor: 'var(--z-danger)' }
                    : undefined
                }
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
