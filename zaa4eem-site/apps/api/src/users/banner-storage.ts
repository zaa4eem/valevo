import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage, type FileFilterCallback } from 'multer';
import type { Request } from 'express';

// Relative to process.cwd(), which is /repo/apps/api both in `nest start`
// and in the production image (WORKDIR /repo/apps/api) — see Dockerfile.
export const BANNERS_DIR = path.join(process.cwd(), 'uploads', 'banners');
fs.mkdirSync(BANNERS_DIR, { recursive: true });

// No GIF here (unlike avatars) — a wide profile banner has no equivalent
// crop-editor need for preserving animation, so keeping this to static
// formats avoids adding a second gifsicle code path for little benefit.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const BANNER_MAX_BYTES = 5 * 1024 * 1024;

export const bannerUploadOptions = {
  storage: diskStorage({
    destination: BANNERS_DIR,
    // Same rationale as avatar-storage.ts: a fresh UUID + verified-mimetype
    // extension, never the client-supplied filename.
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype] ?? ''}`);
    },
  }),
  limits: { fileSize: BANNER_MAX_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      cb(new BadRequestException('Неподдерживаемый тип изображения — используйте JPEG, PNG или WEBP'));
      return;
    }
    cb(null, true);
  },
};
