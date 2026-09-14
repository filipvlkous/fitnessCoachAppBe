import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Ceilings for multipart uploads, in one place because they are a storage
 * decision rather than a per-endpoint one.
 *
 * These are the size of what *arrives*, not what is kept. Images are re-encoded
 * on the way in and land far below the cap; the cap exists so a request that
 * could never produce a sensible image is refused before it is buffered into
 * the container's memory.
 *
 * Video is the opposite case: it is stored as it arrives, so this number is the
 * storage cost. It is deliberately tight. A 30-second exercise demonstration
 * compressed by the phone that recorded it is a few MB, and anything an order
 * of magnitude past that is an uncompressed capture the client should have
 * handled before sending.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const MB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

type MulterFile = { fieldname: string; mimetype: string };
type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

/**
 * Rejects on declared content type, before a byte of the body is read.
 *
 * `accept` maps a form field to the type prefix allowed on it, so the video
 * field cannot be used to smuggle in something that is merely large.
 */
export function mediaFileFilter(accept: Record<string, 'image' | 'video'>) {
  return (_req: Request, file: MulterFile, cb: FileFilterCallback) => {
    const expected = accept[file.fieldname];

    if (!expected) {
      return cb(
        new BadRequestException(`Unexpected field '${file.fieldname}'`),
        false,
      );
    }
    if (!file.mimetype?.startsWith(`${expected}/`)) {
      return cb(
        new BadRequestException(
          `Field '${file.fieldname}' must be ${expected === 'image' ? 'an image' : 'a video'}, got '${file.mimetype || 'unknown'}'`,
        ),
        false,
      );
    }
    cb(null, true);
  };
}

/**
 * The per-field size check multer cannot do.
 *
 * `limits.fileSize` applies one number to every field in a request, so an
 * endpoint taking both an image and a video has to set it to the larger of the
 * two. This re-checks the smaller limit once the buffer exists.
 */
export function assertWithinLimit(
  size: number,
  max: number,
  label: string,
): void {
  if (size > max) {
    throw new BadRequestException(
      `${label} exceeds the ${MB(max)} limit (received ${MB(size)})`,
    );
  }
}
