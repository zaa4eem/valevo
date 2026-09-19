import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage, type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { SCROLL_MAX_BYTES } from '@zaa4eem/shared';

// Relative to process.cwd() (= /repo/apps/api in both `nest start` and the
// production image), like every other upload directory here.
export const SCROLLS_DIR = path.join(process.cwd(), 'uploads', 'scrolls');
/** Raw uploads live here only until ffmpeg has re-encoded them, then they're deleted. */
export const SCROLLS_RAW_DIR = path.join(SCROLLS_DIR, 'raw');
fs.mkdirSync(SCROLLS_RAW_DIR, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-m4v': '.m4v',
  'video/3gpp': '.3gp',
};

export const scrollUploadOptions = {
  storage: diskStorage({
    destination: SCROLLS_RAW_DIR,
    // Never derived from the client-supplied name — a fresh UUID plus an
    // extension from the claimed mimetype, closing off path traversal and
    // double-extension tricks. The claim is only a hint for the extension;
    // what the file really is gets decided by ffprobe, which reads the
    // actual bytes.
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype] ?? '.bin'}`);
    },
  }),
  limits: { fileSize: SCROLL_MAX_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      cb(new BadRequestException('Неподдерживаемый формат видео — снимите или выберите MP4, MOV или WEBM'));
      return;
    }
    cb(null, true);
  },
};
