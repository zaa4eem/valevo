import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ maxWidth: 460, margin: '48px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 46, marginBottom: 12 }}>🧭</div>
      <h1 style={{ fontSize: 'var(--z-fs-xl)', margin: '0 0 10px' }}>Такой страницы нет</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', lineHeight: 1.6, margin: '0 0 22px' }}>
        Ссылка устарела или в адресе опечатка.
      </p>
      <Link href="/" className="z-btn-accent z-pop-on-active">
        В ленту
      </Link>
    </div>
  );
}
