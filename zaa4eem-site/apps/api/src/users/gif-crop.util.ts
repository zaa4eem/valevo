import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function getGifDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync('gifsicle', ['--info', filePath]);
    const match = stdout.match(/logical screen (\d+)x(\d+)/);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    return null;
  }
}

/**
 * Crops an animated GIF to an arbitrary rectangular region and resizes it,
 * in place — gifsicle rewrites every frame, unlike a <canvas> draw (used
 * for JPEG/PNG/WEBP) which only captures the currently-displayed frame and
 * would silently kill the animation. Coordinates are clamped to the GIF's
 * real dimensions defensively (the client already keeps them in bounds,
 * but never trust client-supplied numbers as-is). No-ops — leaves the
 * uploaded file untouched — if gifsicle is missing or the GIF is
 * malformed, so a broken crop never fails the whole upload.
 *
 * Square avatars and wide banners both go through this — a square crop is
 * just the width===height case, not a separate code path.
 */
export async function cropGifInPlace(
  filePath: string,
  crop: { x: number; y: number; width: number; height: number },
  output: { width: number; height: number },
): Promise<void> {
  const dims = await getGifDimensions(filePath);
  if (!dims) return;

  const width = Math.max(1, Math.min(Math.round(crop.width), dims.width));
  const height = Math.max(1, Math.min(Math.round(crop.height), dims.height));
  const x = Math.min(Math.max(0, Math.round(crop.x)), dims.width - width);
  const y = Math.min(Math.max(0, Math.round(crop.y)), dims.height - height);

  const tmpPath = path.join(path.dirname(filePath), `.tmp-${randomUUID()}.gif`);
  try {
    await execFileAsync('gifsicle', [
      '--crop',
      `${x},${y}+${width}x${height}`,
      '--resize',
      `${output.width}x${output.height}`,
      '--output',
      tmpPath,
      filePath,
    ]);
    await fs.promises.rename(tmpPath, filePath);
  } catch {
    await fs.promises.rm(tmpPath, { force: true });
  }
}
