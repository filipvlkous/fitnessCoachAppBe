import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/**
 * The one place an uploaded image is turned into something worth storing.
 *
 * Every upload path used to carry its own sharp call with its own quality
 * setting — 75 here, 80 there, and nothing at all on body photos, which went to
 * storage as whatever the phone produced. Storage is billed on what is kept and
 * what is served, so the three copies are now one.
 *
 * WebP rather than AVIF: AVIF is another ~25% smaller at matching quality, but
 * encoding costs several times the CPU and decoding needs iOS 16 / Android 12.
 * WebP is understood by everything that can display an image at all.
 */

export type CompressImageOptions = {
  /** Longest edge, in pixels. The image is never enlarged to reach it. */
  maxWidth: number;
  maxHeight: number;
  /**
   * `inside` fits the whole image within the box and keeps its aspect ratio.
   * `cover` fills the box and crops the overflow — only wanted for avatars,
   * where a square is the point.
   */
  fit?: 'inside' | 'cover';
};

/**
 * Quality 70 is the knee of the curve for photographic content: the step down
 * from 80 takes roughly a third off the file, and the artefacts it introduces
 * live in detail that a 400px avatar or a 1200px gallery image has already lost
 * to the resize. Below ~65 they become visible on skin tones, which is most of
 * what this app stores.
 */
const WEBP_QUALITY = 70;

export async function compressImage(
  input: Buffer,
  { maxWidth, maxHeight, fit = 'inside' }: CompressImageOptions,
): Promise<Buffer> {
  try {
    return await sharp(input)
      // Honour the EXIF orientation tag before it is dropped with the rest of
      // the metadata below. Without this a photo taken on a phone held sideways
      // is stored rotated, because sharp strips the tag that told the viewer to
      // turn it back.
      .rotate()
      .resize(maxWidth, maxHeight, { fit, withoutEnlargement: true })
      .webp({
        quality: WEBP_QUALITY,
        // Slowest setting: seconds of CPU once, against a file served for the
        // life of the account.
        effort: 6,
        // `smartSubsample` is deliberately left off. It improves chroma on
        // sharp colour edges, but measured against this app's own sizes it
        // costs ~70% more bytes at matching quality — 29 KB to 50 KB on a
        // 1200px photo — which is the whole point of this helper, in reverse.
      })
      .toBuffer();
  } catch (error: unknown) {
    // Deliberately not falling back to the original buffer. Callers name the
    // stored object `.webp` and upload it as `image/webp`, so handing back
    // something sharp could not even decode puts an object in the bucket that
    // is not what its name and content type claim.
    throw new BadRequestException(
      `Image could not be processed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
