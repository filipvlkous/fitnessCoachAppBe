/**
 * The rule for laying a coach's version over the shared catalogue.
 *
 * Pulled out of the service because it is the whole feature in five lines and
 * the one thing that must not drift: a coach who writes only cues must not
 * blank out the picture their client was using yesterday. It is arithmetic over
 * nulls, and arithmetic that decides what an athlete sees mid-set is worth
 * pinning down in a test rather than reading off a query.
 */

/** The overridable half of an exercise, as one coach wrote it. */
export interface CoachExerciseVersion {
  description: string | null;
  img_url: string | null;
  youtube_url: string | null;
}

/** The catalogue row, which always exists and is the fallback for every field. */
export interface CatalogueExercise {
  description: string | null;
  img_url: string | null;
  img_url_2: string | null;
  video_url: string | null;
  youtube_url: string | null;
}

export interface ResolvedExercise {
  description: string | null;
  img_url: string | null;
  img_url_2: string | null;
  video_url: string | null;
  youtube_url: string | null;
}

/**
 * Field by field, never wholesale. A null on the version means "no opinion",
 * and an absent version means the same for every field — which is why no
 * version and an empty version resolve identically.
 *
 * `video_url` is never overridden: the uploaded clip stays shared across
 * coaches, so it always comes from the catalogue.
 *
 * The two catalogue images are the one exception to going field by field:
 * they are a gallery the athlete swipes through, and a coach has a single
 * image slot of their own. So their picture replaces the gallery rather than
 * joining it — otherwise a client would swipe from their coach's photo onto a
 * second one from the catalogue the coach never chose and cannot remove.
 */
export function resolveExerciseForViewer(
  catalogue: CatalogueExercise,
  version: CoachExerciseVersion | null,
): ResolvedExercise {
  return {
    description: version?.description ?? catalogue.description ?? null,
    img_url: version?.img_url ?? catalogue.img_url ?? null,
    img_url_2: version?.img_url ? null : (catalogue.img_url_2 ?? null),
    youtube_url: version?.youtube_url ?? catalogue.youtube_url ?? null,
    video_url: catalogue.video_url ?? null,
  };
}
