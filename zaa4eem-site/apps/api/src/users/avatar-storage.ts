import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage, type FileFilterCallback } from 'multer';
import type { Request } from 'express';

// Relative to process.cwd(), which is /repo/apps/api both in `nest start`
// and in the production image (WORKDIR /repo/apps/api) — see Dockerfile.
export const AVATARS_DIR = path.join(process.cwd(), 'uploads', 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

export const avatarUploadOptions = {
  storage: diskStorage({
    destination: AVATARS_DIR,
    // The stored filename never derives from the client-supplied name —
    // it's a fresh UUID with an extension picked from the *verified*
    // mimetype, not the original filename, closing off any path-traversal
    // or double-extension trick via the upload's filename field.
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype] ?? ''}`);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      cb(new BadRequestException('Unsupported image type — use JPEG, PNG, WEBP or GIF'));
      return;
    }
    cb(null, true);
  },
};
