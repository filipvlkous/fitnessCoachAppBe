# Upload compression

Everything a user uploads is billed twice: once to keep it, and again every
time it is served. This is how that cost is held down, and why the video half
looks nothing like the image half.

## Images

One helper, `utils/compress-image.ts`, is the only place an upload is encoded.
Before this there were three sharp calls with three different quality settings,
and body photos went to the bucket untouched.

Output is always WebP, quality 70, encoder effort 6, metadata stripped.

| Upload | Box | Fit |
| --- | --- | --- |
| Coach avatar | 400x400 | cover |
| Coach gallery | 1200x1200 | inside |
| Exercise catalogue image | 1280x720 | inside |
| Body photo | 1080x1440 | inside |

Measured against the settings they replaced, on one 12 MP source with heavy
grain: exercise images -66%, gallery -22%, avatars -16%. Body photos were not
compressed at all before, so the change there is the whole file.

The exercise number is large because the old setting was 80, and libwebp's size
curve turns sharply upward above ~75 for little visible gain.

Three things in the helper are load-bearing and easy to undo by accident:

- **`.rotate()` comes first.** sharp drops EXIF on output. Without an explicit
  rotate, the orientation tag that told a viewer to turn a phone photo upright
  goes with it, and the stored image is sideways.
- **`smartSubsample` stays off.** It sounds like a compression win and is the
  opposite: measured at 1200px it costs ~70% more bytes at matching quality,
  29 KB against 50 KB.
- **A failed encode throws, it does not fall back to the original.** Callers
  name the object `.webp` and upload it as `image/webp`. Handing back a buffer
  sharp could not decode would put an object in the bucket that lies about what
  it is. The old exercise path did exactly that.

AVIF was considered and rejected: ~25% smaller again, but several times the CPU
to encode and it needs iOS 16 / Android 12 to decode.

## Video

Not re-encoded. Stored as it arrives, with its real content type rather than an
assumed `video/mp4`, because iOS records QuickTime.

Server-side transcoding would mean ffmpeg in the image and the transcode running
inside the request handler, where one large clip occupies a worker for minutes.
There is no queue to hand that to. The client compresses before uploading, which
a phone does on its own hardware at no cost to us.

`MAX_VIDEO_BYTES` is what makes that a rule rather than a hope. It is
deliberately tight: a 30-second demonstration compressed on the device is a few
MB, and an order of magnitude past that is an uncompressed capture.

If server-side transcoding is ever wanted, the prerequisite is a job queue, not
an ffmpeg dependency.

## Caps

`utils/upload-limits.ts` holds both ceilings and the field-to-type filter.

| | Limit |
| --- | --- |
| `MAX_IMAGE_BYTES` | 10 MB |
| `MAX_VIDEO_BYTES` | 50 MB |

These bound what *arrives*. Images land far below the image cap after encoding;
the cap is there so a request that could never produce a sensible image is
refused before it is buffered into the container's memory. The video number is
different in kind, because it is what gets stored.

`mediaFileFilter` rejects on declared content type before the body is read, and
maps each form field to the type allowed on it, so the video field cannot be
used to send something that is merely large. multer applies `limits.fileSize`
once across every field in a request, so the endpoint taking both an image and a
video sets it to the video number and re-checks the image against its own limit
after buffering.
