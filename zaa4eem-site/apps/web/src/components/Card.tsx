import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  hover = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={`z-card ${hover ? 'z-card-hover' : ''} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
