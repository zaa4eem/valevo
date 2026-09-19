import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { SCROLL_MAX_DURATION_S, SCROLL_TARGET_HEIGHT } from '@zaa4eem/shared';
import { SCROLLS_DIR } from './video-storage';

const run = promisify(execFile);

/** Long enough for a 90-second clip on a small VPS, short enough that a wedged ffmpeg can't pile up. */
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 30 * 1000;

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
}

export interface TranscodeResult extends ProbeResult {
  videoPath: string;
  posterPath: string;
}

export class VideoRejected extends Error {}

@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  /**
   * Reads what the file actually is.
   *
   * The upload's Content-Type is a claim by the client and nothing more, so
   * this is the only thing that decides whether a file is a video — the
   * equivalent of the byte-signature check images go through, except a
   * container's magic bytes don't tell you whether there is a playable
   * video stream inside.
   */
  async probe(filePath: string): Promise<ProbeResult> {
    let stdout: string;
    try {
      ({ stdout } = await run(
        'ffprobe',
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height',
          '-show_entries', 'format=duration',
          '-of', 'json',
          filePath,
        ],
        { timeout: FFPROBE_TIMEOUT_MS },
      ));
    } catch {
      throw new VideoRejected('Файл не читается как видео');
    }

    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream.height) throw new VideoRejected('В файле нет видеодорожки');

    const durationS = Number(parsed.format?.duration ?? 0);
    if (!Number.isFinite(durationS) || durationS <= 0) throw new VideoRejected('Не удалось определить длину видео');
    if (durationS > SCROLL_MAX_DURATION_S + 1) {
      throw new VideoRejected(`Слишком длинное видео — максимум ${SCROLL_MAX_DURATION_S} секунд`);
    }

    return { durationMs: Math.round(durationS * 1000), width: stream.width, height: stream.height };
  }

  /**
   * Re-encodes to something every phone can play, and grabs a cover frame.
   *
   * Re-encoding rather than storing the upload as-is is the whole point: a
   * feed plays clips back to back, so one HEVC .mov from an iPhone that
   * Android refuses to decode doesn't just fail on its own — it stops the
   * scroll dead. H.264 + AAC in MP4 plays everywhere, and +faststart puts
   * the index at the front so playback can start before the file has
   * finished downloading.
   */
  async transcode(inputPath: string): Promise<TranscodeResult> {
    const probe = await this.probe(inputPath);
    const id = randomUUID();
    const videoPath = path.join(SCROLLS_DIR, `${id}.mp4`);
    const posterPath = path.join(SCROLLS_DIR, `${id}.jpg`);

    // Scaled down only, never up (`min(ih,H)`), and both sides forced even
    // because H.264's chroma subsampling cannot encode an odd dimension.
    const scale = `scale=-2:'min(ih,${SCROLL_TARGET_HEIGHT})':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

    try {
      await run(
        'ffmpeg',
        [
          '-nostdin', '-y',
          '-i', inputPath,
          '-t', String(SCROLL_MAX_DURATION_S),
          '-vf', scale,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '26',
          '-pix_fmt', 'yuv420p',
          // Some uploads have no audio at all; -c:a only applies if there is
          // a track, and ffmpeg is happy either way.
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          videoPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      await safeUnlink(videoPath);
      this.logger.warn(`ffmpeg failed for ${inputPath}: ${err instanceof Error ? err.message : err}`);
      throw new VideoRejected('Не удалось обработать видео');
    }

    // The cover frame comes from the *transcoded* file, so it can never
    // show something the published clip doesn't contain.
    const posterAt = Math.min(1, probe.durationMs / 2000);
    try {
      await run(
        'ffmpeg',
        ['-nostdin', '-y', '-ss', posterAt.toFixed(2), '-i', videoPath, '-frames:v', '1', '-q:v', '3', posterPath],
        { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      await safeUnlink(videoPath);
      await safeUnlink(posterPath);
      this.logger.warn(`poster failed for ${videoPath}: ${err instanceof Error ? err.message : err}`);
      throw new VideoRejected('Не удалось сделать обложку');
    }

    // Read back from the encoded file: the scale filter is what actually
    // decided the output size, so the source's numbers would be wrong.
    const encoded = await this.probe(videoPath);
    return { ...encoded, videoPath, posterPath };
  }
}

export async function safeUnlink(filePath: string) {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Already gone, or never written — either way there is nothing to do.
  }
}
