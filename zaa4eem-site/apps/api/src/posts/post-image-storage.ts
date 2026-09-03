import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage, type FileFilterCallback } from 'multer';
import type { Request } from 'express';

// Relative to process.cwd(), which is /repo/apps/api both in `nest start`
// and in the production image (WORKDIR /repo/apps/api) — see Dockerfile.
// Kept in its own subdirectory (not uploads/avatars) since post images and
// avatars are unrelated content with different lifecycles.
export const POST_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'post-images');
fs.mkdirSync(POST_IMAGES_DIR, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Post photos are the actual content of a post (not a small square avatar),
// so people reasonably attach higher-resolution phone photos — 8MB gives
// headroom for that while avatars stay capped at 3MB (see avatar-storage.ts).
export const POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const postImageUploadOptions = {
  storage: diskStorage({
    destination: POST_IMAGES_DIR,
    // The stored filename never derives from the client-supplied name —
    // it's a fresh UUID with an extension picked from the *verified*
    // mimetype, not the original filename, closing off any path-traversal
    // or double-extension trick via the upload's filename field.
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype] ?? ''}`);
    },
  }),
  limits: { fileSize: POST_IMAGE_MAX_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      cb(new BadRequestException('Неподдерживаемый тип изображения — используйте JPEG, PNG, WEBP или GIF'));
      return;
    }
    cb(null, true);
  },
};
