import * as fs from 'fs';

/**
 * Verifies an uploaded file's first bytes actually match the image format
 * its (client-supplied, spoofable) Content-Type claims — multer's
 * fileFilter only sees that header, never the real bytes, since it runs
 * before the body is streamed to disk. Call this after the file has
 * landed on disk (once @UploadedFile() gives you its path) and delete it
 * if this returns false, rather than trusting the extension it was stored
 * under to reflect its real content.
 */
export async function matchesImageSignature(filePath: string, mimetype: string): Promise<boolean> {
  const check = SIGNATURE_CHECK[mimetype];
  if (!check) return false;

  const fd = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await fd.read(header, 0, header.length, 0);
    return check(header.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

const SIGNATURE_CHECK: Record<string, (header: Buffer) => boolean> = {
  'image/jpeg': (h) => h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  'image/png': (h) => h.length >= 8 && h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (h) =>
    h.length >= 12 && h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP',
  'image/gif': (h) => h.length >= 6 && ['GIF87a', 'GIF89a'].includes(h.subarray(0, 6).toString('ascii')),
};
