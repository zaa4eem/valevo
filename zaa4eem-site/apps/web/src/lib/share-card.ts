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
 * Renders the card and hands it to the OS share sheet where supported
 * (works in Telegram's in-app browser on most platforms); falls back to
 * downloading the image and copying the share text to the clipboard.
 */
export async function shareScoreCard(gameTitle: string, score: number): Promise<'shared' | 'downloaded'> {
  const canvas = renderScoreCard(gameTitle, score);
  const blob = await canvasToBlob(canvas);
  const text = `Набрал ${score} очков в «${gameTitle}» на ZAA4EEM — обгони! ${SITE_URL}`;
  const file = new File([blob], 'zaa4eem-score.png', { type: 'image/png' });

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
  link.download = 'zaa4eem-score.png';
  link.click();
  URL.revokeObjectURL(url);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be denied — the downloaded image is still useful on its own.
  }
  return 'downloaded';
}
