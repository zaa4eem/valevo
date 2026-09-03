'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'zaa4eem_theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled — theme just won't persist across reloads.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="z-theme-toggle"
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
