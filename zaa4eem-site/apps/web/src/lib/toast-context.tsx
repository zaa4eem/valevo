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
  resolve: (ok: boolean) => void;
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
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => undefined,
  confirm: async () => false,
});

const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
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
          resolve,
        });
      }),
    [],
  );

  function answer(ok: boolean) {
    request?.resolve(ok);
    setRequest(null);
  }

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

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
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => answer(false)} className="z-btn-ghost z-pop-on-active">
                {request.cancelLabel}
              </button>
              <button
                onClick={() => answer(true)}
                className="z-btn-accent z-pop-on-active"
                autoFocus
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
