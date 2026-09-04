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
 * Crops an animated GIF to a square region and resizes it, in place —
 * gifsicle rewrites every frame, unlike a <canvas> draw (used for
 * JPEG/PNG/WEBP avatars) which only captures the currently-displayed frame
 * and would silently kill the animation. Coordinates are clamped to the
 * GIF's real dimensions defensively (the client already keeps them in
 * bounds, but never trust client-supplied numbers as-is). No-ops — leaves
 * the uploaded file untouched — if gifsicle is missing or the GIF is
 * malformed, so a broken crop never fails the whole upload.
 */
export async function cropGifInPlace(
  filePath: string,
  crop: { x: number; y: number; size: number },
  outputSize = 512,
): Promise<void> {
  const dims = await getGifDimensions(filePath);
  if (!dims) return;

  const size = Math.max(1, Math.min(Math.round(crop.size), dims.width, dims.height));
  const x = Math.min(Math.max(0, Math.round(crop.x)), dims.width - size);
  const y = Math.min(Math.max(0, Math.round(crop.y)), dims.height - size);

  const tmpPath = path.join(path.dirname(filePath), `.tmp-${randomUUID()}.gif`);
  try {
    await execFileAsync('gifsicle', [
      '--crop',
      `${x},${y}+${size}x${size}`,
      '--resize',
      `${outputSize}x${outputSize}`,
      '--output',
      tmpPath,
      filePath,
    ]);
    await fs.promises.rename(tmpPath, filePath);
  } catch {
    await fs.promises.rm(tmpPath, { force: true });
  }
}
