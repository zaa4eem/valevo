const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');

/** Renders a "beat my score" share card entirely client-side (canvas) — no server round-trip or image-rendering dependency needed. */
function renderScoreCard(gameTitle: string, score: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d')!;

  const bgGradient = ctx.createLinearGradient(0, 0, 800, 800);
  bgGradient.addColorStop(0, '#122016');
  bgGradient.addColorStop(0.6, '#0b0e0d');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, 800, 800);

  ctx.fillStyle = '#5b6b65';
  ctx.font = '600 26px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameTitle.toUpperCase(), 400, 280);

  ctx.fillStyle = '#4ade80';
  ctx.font = '900 180px Inter, sans-serif';
  ctx.fillText(String(score), 400, 440);

  ctx.fillStyle = '#8fa39a';
  ctx.font = '500 24px Inter, sans-serif';
  ctx.fillText('Новый личный рекорд', 400, 500);

  ctx.strokeStyle = '#232b28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 660);
  ctx.lineTo(740, 660);
  ctx.stroke();

  ctx.fillStyle = '#5b6b65';
  ctx.font = '600 22px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Обгони в', 60, 720);
  ctx.fillStyle = '#4ade80';
  ctx.font = '900 28px Inter, sans-serif';
  ctx.fillText('ZAA4EEM', 200, 722);

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))), 'image/png');
  });
}

/**
 * Hands a rendered card to the OS share sheet where supported (works in
 * Telegram's in-app browser on most platforms); falls back to downloading
 * the image and copying the share text to the clipboard.
 */
async function shareCanvas(canvas: HTMLCanvasElement, filename: string, text: string): Promise<'shared' | 'downloaded'> {
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], filename, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: 'ZAA4EEM' });
      return 'shared';
    } catch {
      // User cancelled the share sheet, or the platform rejected it — fall
      // through to the download fallback rather than leaving the tap silent.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be denied — the downloaded image is still useful on its own.
  }
  return 'downloaded';
}

export async function shareScoreCard(gameTitle: string, score: number): Promise<'shared' | 'downloaded'> {
  const canvas = renderScoreCard(gameTitle, score);
  const text = `Набрал ${score} очков в «${gameTitle}» на ZAA4EEM — обгони! ${SITE_URL}`;
  return shareCanvas(canvas, 'zaa4eem-score.png', text);
}

export interface ProfileCardData {
  displayName: string;
  memberNumber: number;
  ideasAcceptedCount: number;
  gamesPlayedCount: number;
  bestScore: number | null;
}

/**
 * Renders a "визитка" profile card — no avatar photo (drawing a
 * cross-origin image onto canvas without CORS headers on the uploads host
 * would taint the canvas and break toBlob/toDataURL), just initials on a
 * colored circle, matching the app's own no-avatar fallback look.
 */
function renderProfileCard(data: ProfileCardData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d')!;

  const bgGradient = ctx.createLinearGradient(0, 0, 800, 800);
  bgGradient.addColorStop(0, '#122016');
  bgGradient.addColorStop(0.6, '#0b0e0d');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, 800, 800);

  ctx.beginPath();
  ctx.arc(400, 220, 90, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(74, 222, 128, 0.14)';
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#4ade80';
  ctx.font = '900 76px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.displayName.charAt(0).toUpperCase(), 400, 224);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#f4f7f5';
  ctx.font = '800 46px Inter, sans-serif';
  ctx.fillText(data.displayName, 400, 370);

  ctx.fillStyle = '#5b6b65';
  ctx.font = '600 24px Inter, sans-serif';
  ctx.fillText(`#${String(data.memberNumber).padStart(4, '0')}`, 400, 408);

  const stats: [string, string][] = [
    [String(data.ideasAcceptedCount), 'идей принято'],
    [String(data.gamesPlayedCount), 'игр сыграно'],
    [data.bestScore !== null ? String(data.bestScore) : '—', 'рекорд'],
  ];
  const colXs = [180, 400, 620];
  stats.forEach(([value, label], i) => {
    ctx.fillStyle = '#4ade80';
    ctx.font = '900 48px Inter, sans-serif';
    ctx.fillText(value, colXs[i], 500);
    ctx.fillStyle = '#8fa39a';
    ctx.font = '500 20px Inter, sans-serif';
    ctx.fillText(label, colXs[i], 532);
  });

  ctx.strokeStyle = '#232b28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 660);
  ctx.lineTo(740, 660);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#5b6b65';
  ctx.font = '600 22px Inter, sans-serif';
  ctx.fillText('Профиль на', 60, 720);
  ctx.fillStyle = '#4ade80';
  ctx.font = '900 28px Inter, sans-serif';
  ctx.fillText('ZAA4EEM', 230, 722);

  return canvas;
}

export async function shareProfileCard(data: ProfileCardData, profileUrl: string): Promise<'shared' | 'downloaded'> {
  const canvas = renderProfileCard(data);
  const text = `Профиль ${data.displayName} на ZAA4EEM: ${profileUrl}`;
  return shareCanvas(canvas, 'zaa4eem-profile.png', text);
}

export interface PostCardData {
  authorName: string;
  body: string;
  likeCount: number;
  commentCount: number;
}

/** Post text is arbitrary length — wrapped to a fixed width and clamped to a few lines so the card never overflows. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '')}…`;
  }
  return lines;
}

/** Renders a shareable card for one post — same visual language as the score/profile cards. */
function renderPostCard(data: PostCardData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const ctx = canvas.getContext('2d')!;

  const bgGradient = ctx.createLinearGradient(0, 0, 800, 800);
  bgGradient.addColorStop(0, '#122016');
  bgGradient.addColorStop(0.6, '#0b0e0d');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, 800, 800);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#4ade80';
  ctx.font = '900 32px Inter, sans-serif';
  ctx.fillText(data.authorName, 60, 140);

  ctx.fillStyle = '#5b6b65';
  ctx.font = '600 22px Inter, sans-serif';
  ctx.fillText('на ZAA4EEM', 60, 172);

  ctx.fillStyle = '#f4f7f5';
  ctx.font = '500 34px Inter, sans-serif';
  const lines = wrapText(ctx, data.body, 680, 8);
  lines.forEach((line, i) => ctx.fillText(line, 60, 260 + i * 46));

  ctx.fillStyle = '#8fa39a';
  ctx.font = '600 24px Inter, sans-serif';
  ctx.fillText(`🤍 ${data.likeCount}   💬 ${data.commentCount}`, 60, 620);

  ctx.strokeStyle = '#232b28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 660);
  ctx.lineTo(740, 660);
  ctx.stroke();

  ctx.fillStyle = '#5b6b65';
  ctx.font = '600 22px Inter, sans-serif';
  ctx.fillText('Читай на', 60, 720);
  ctx.fillStyle = '#4ade80';
  ctx.font = '900 28px Inter, sans-serif';
  ctx.fillText('ZAA4EEM', 200, 722);

  return canvas;
}

export async function sharePostCard(data: PostCardData): Promise<'shared' | 'downloaded'> {
  const canvas = renderPostCard(data);
  const text = `Пост от ${data.authorName} на ZAA4EEM: ${SITE_URL}`;
  return shareCanvas(canvas, 'zaa4eem-post.png', text);
}
