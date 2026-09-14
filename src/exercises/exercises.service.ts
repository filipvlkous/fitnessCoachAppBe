// src/exercises/exercises.service.ts
import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateExerciseDto,
  UpdateExerciseCatalogDto,
  UpsertCoachExerciseVersionDto,
} from './dto/exercises.dto';
import {
  CoachExerciseVersion,
  resolveExerciseForViewer,
} from './exercise-version';
import { compressImage } from 'utils/compress-image';
import path from 'path';

@Injectable()
export class ExercisesService {
  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  // Every shape a coach might paste, down to the 11-character video id:
  // watch?v=, youtu.be/, /shorts/, /embed/, /live/, with or without the www or
  // m/music subdomain, and with any of the tracking params YouTube's share
  // sheet appends. `list=` playlist ids are 13+ chars and never match.
  private static readonly YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
  private static readonly YOUTUBE_PATH_PREFIXES = [
    'shorts',
    'embed',
    'live',
    'v',
    'e',
  ];

  private extractYouTubeId(raw: string): string | null {
    // A bare id, e.g. pasted out of another tool. Checked before URL parsing
    // because `new URL('https://dQw4w9WgXcQ')` succeeds — as a hostname.
    if (ExercisesService.YOUTUBE_ID.test(raw)) return raw;

    let parsed: URL;
    try {
      // A pasted link often arrives without a scheme ("youtu.be/abc").
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }

    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const segments = parsed.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      const id = segments[0];
      return id && ExercisesService.YOUTUBE_ID.test(id) ? id : null;
    }

    if (
      host !== 'youtube.com' &&
      host !== 'youtube-nocookie.com' &&
      host !== 'm.youtube.com' &&
      host !== 'music.youtube.com'
    ) {
      return null;
    }

    const queryId = parsed.searchParams.get('v');
    if (queryId && ExercisesService.YOUTUBE_ID.test(queryId)) return queryId;

    if (
      segments.length >= 2 &&
      ExercisesService.YOUTUBE_PATH_PREFIXES.includes(segments[0].toLowerCase())
    ) {
      const id = segments[1];
      return ExercisesService.YOUTUBE_ID.test(id) ? id : null;
    }

    return null;
  }

  // `undefined` in, `undefined` out: the field was not part of the request and
  // must not be written. An empty string is how the app clears the link, and
  // becomes an explicit null. Anything else has to be a real YouTube link —
  // rejected here rather than saved and rendered as a blank player later.
  private normalizeYouTubeUrl(
    value: string | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (!this.extractYouTubeId(trimmed)) {
      throw new BadRequestException(
        'youtube_url must be a YouTube video link (e.g. https://youtu.be/dQw4w9WgXcQ)',
      );
    }

    // Stored as pasted so a `?t=` start offset survives; the app re-parses it.
    return trimmed;
  }

  // Create a new exercise
  async create(dto: CreateExerciseDto): Promise<{ id: string }> {
    const youtube_url = this.normalizeYouTubeUrl(dto.youtube_url);

    const { data, error } = await this.supabase
      .from('exercises')
      .insert(youtube_url === undefined ? dto : { ...dto, youtube_url })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    return data;
  }

  // Get all exercises
  async findAll(muscleGroup?: string) {
    let query = this.supabase.from('exercises').select('*').order('name');

    if (muscleGroup) {
      query = query.eq('muscle_group', muscleGroup);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data;
  }

  // Get exercise by ID
  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('exercises')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException(`Exercise with ID ${id} not found`);
    return data;
  }

  // Update exercise
  async update(id: string, dto: UpdateExerciseCatalogDto) {
    const youtube_url = this.normalizeYouTubeUrl(dto.youtube_url);

    const { error } = await this.supabase
      .from('exercises')
      .update(youtube_url === undefined ? dto : { ...dto, youtube_url })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  private parseStorageLocation(
    url?: string,
  ): { bucket: string; path: string } | null {
    if (!url) return null;

    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      // Expected: /storage/v1/object/(public|sign)/:bucket/:path
      const objectIndex = parts.indexOf('object');
      if (objectIndex === -1) return null;
      const bucket = parts[objectIndex + 2];
      const pathParts = parts.slice(objectIndex + 3);
      if (!bucket || pathParts.length === 0) return null;
      return { bucket, path: pathParts.join('/') };
    } catch {
      return null;
    }
  }

  // Delete exercise
  async remove(id: string) {
    const { data: media, error: mediaError } = await this.supabase
      .from('exercises')
      .select('img_url, video_url')
      .eq('id', id)
      .single();

    if (mediaError && mediaError.code !== 'PGRST116') {
      throw new Error(mediaError.message);
    }

    // Coaches' own versions go with the exercise by foreign key, but their
    // uploaded images do not — those are storage objects, and nothing else
    // would ever reference them again.
    const { data: versions, error: versionError } = await this.supabase
      .from('exercise_coach_versions')
      .select('img_url')
      .eq('exercise_id', id)
      .returns<{ img_url: string | null }[]>();

    if (versionError) throw new Error(versionError.message);

    const locations = [
      this.parseStorageLocation(media?.img_url),
      this.parseStorageLocation(media?.video_url),
      ...(versions ?? []).map((version) =>
        this.parseStorageLocation(version.img_url ?? undefined),
      ),
    ].filter((location): location is { bucket: string; path: string } =>
      Boolean(location),
    );

    if (locations.length > 0) {
      const bucketMap = new Map<string, string[]>();
      for (const location of locations) {
        const list = bucketMap.get(location.bucket) || [];
        list.push(location.path);
        bucketMap.set(location.bucket, list);
      }

      for (const [bucket, paths] of bucketMap.entries()) {
        const { error: storageError } = await this.supabase.storage
          .from(bucket)
          .remove(paths);

        if (storageError) throw new Error(storageError.message);
      }
    }

    const { error } = await this.supabase
      .from('exercises')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
    return { message: 'Exercise deleted successfully' };
  }

  /**
   * Whose version of an exercise this viewer should be shown: the coach who
   * trains them. The `limit(1)` matches every other coach lookup in this
   * codebase — the app models one coach per athlete, and the app's own session
   * carries a single `coachId`.
   *
   * Deliberately *not* "the viewer's own version when the viewer is a coach".
   * A coach's exercise screen reads this same endpoint to populate the editor
   * that writes back to the shared catalogue: hand it an overlaid image and the
   * next save copies that coach's private picture into the catalogue everyone
   * else reads. Coaches see their own version in its own card, loaded through
   * `getCoachVersion`, where there is no such ambiguity.
   *
   * Null means no version applies — an athlete training on their own — and the
   * catalogue stands.
   */
  private async resolveVersionCoachId(
    viewerId?: string,
  ): Promise<string | null> {
    if (!viewerId) return null;

    const { data: relation } = await this.supabase
      .from('coach_user_relations')
      .select('coach_id')
      .eq('user_id', viewerId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();

    return relation?.coach_id ?? null;
  }

  private async findCoachVersion(
    exerciseId: string,
    coachId: string | null,
  ): Promise<CoachExerciseVersion | null> {
    if (!coachId) return null;

    const { data, error } = await this.supabase
      .from('exercise_coach_versions')
      .select('description, img_url, youtube_url')
      .eq('exercise_id', exerciseId)
      .eq('coach_id', coachId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data as CoachExerciseVersion | null) ?? null;
  }

  /**
   * What this viewer should see for an exercise: the catalogue, with their
   * coach's own version laid over it by `resolveExerciseForViewer`.
   *
   * `description` comes back with every `type`. It is one text column on a row
   * already being read, and the logger's header needs it whichever media
   * section prompted the call.
   */
  async getMedia(
    exerciseId: string,
    type: 'image' | 'video' | 'both' = 'both',
    viewerId?: string,
  ) {
    const { data, error } = await this.supabase
      .from('exercises')
      .select('description, img_url, video_url, youtube_url')
      .eq('id', exerciseId)
      .single();

    if (error) throw new Error(error.message);

    const version = await this.findCoachVersion(
      exerciseId,
      await this.resolveVersionCoachId(viewerId),
    );

    const { description, img_url, video_url, youtube_url } =
      resolveExerciseForViewer(data, version);

    if (type === 'image') return { description, img_url };
    // The YouTube link rides along with the video selection: both feed the
    // same "video" section in the app, and the logger asks for type=video.
    if (type === 'video') return { description, video_url, youtube_url };
    return { description, img_url, video_url, youtube_url };
  }

  /** The coach's own version, for their editor. Null when they have none. */
  async getCoachVersion(exerciseId: string, coachId: string) {
    return this.findCoachVersion(exerciseId, coachId);
  }

  /**
   * Write the coach's text and link. Same three-state convention as the
   * catalogue: an absent key leaves the stored value alone, '' clears it back
   * to the catalogue's, text overrides.
   *
   * The image is not written here — it is a file with its own endpoint — but an
   * upsert must not drop it, so the existing row is read first and its
   * `img_url` carried through.
   */
  async upsertCoachVersion(
    exerciseId: string,
    coachId: string,
    dto: UpsertCoachExerciseVersionDto,
  ): Promise<CoachExerciseVersion> {
    // 404 rather than a foreign-key error from Postgres: a coach writing a
    // version of an exercise someone else has just deleted should read as the
    // exercise being gone, not as a failed save.
    await this.findOne(exerciseId);

    const existing = await this.findCoachVersion(exerciseId, coachId);

    const description =
      dto.description === undefined
        ? (existing?.description ?? null)
        : dto.description.trim() || null;

    const youtubeInput = this.normalizeYouTubeUrl(dto.youtube_url);
    const youtube_url =
      youtubeInput === undefined
        ? (existing?.youtube_url ?? null)
        : youtubeInput;

    const { data, error } = await this.supabase
      .from('exercise_coach_versions')
      .upsert(
        {
          exercise_id: exerciseId,
          coach_id: coachId,
          description,
          youtube_url,
          img_url: existing?.img_url ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'exercise_id,coach_id' },
      )
      .select('description, img_url, youtube_url')
      .single();

    if (error) throw new Error(error.message);
    return data as CoachExerciseVersion;
  }

  /**
   * Replace the image on the coach's version. Compressed and stored exactly
   * like a catalogue image, in the same bucket — the app cannot tell the two
   * apart, and should not have to.
   *
   * The previous object is deleted after the row points at the new one: a
   * failed cleanup leaves an orphan file, while cleaning up first would leave a
   * live row pointing at nothing if the upload then failed.
   */
  async uploadCoachVersionImage(
    exerciseId: string,
    coachId: string,
    imageFile: { file: Buffer; filename: string },
  ): Promise<CoachExerciseVersion> {
    await this.findOne(exerciseId);

    const existing = await this.findCoachVersion(exerciseId, coachId);

    const compressed = await this.compressExerciseImage(imageFile.file);
    const imagePath = `coach-version-${coachId}-${Date.now()}.webp`;

    const { error: uploadError } = await this.supabase.storage
      .from('images')
      .upload(imagePath, compressed, {
        cacheControl: '31536000',
        upsert: false,
        contentType: 'image/webp',
      });

    if (uploadError)
      throw new Error(`Image upload failed: ${uploadError.message}`);

    const { data: publicUrl } = this.supabase.storage
      .from('images')
      .getPublicUrl(imagePath);

    const { data, error } = await this.supabase
      .from('exercise_coach_versions')
      .upsert(
        {
          exercise_id: exerciseId,
          coach_id: coachId,
          description: existing?.description ?? null,
          youtube_url: existing?.youtube_url ?? null,
          img_url: publicUrl.publicUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'exercise_id,coach_id' },
      )
      .select('description, img_url, youtube_url')
      .single();

    if (error) throw new Error(error.message);

    await this.removeStorageObjects([existing?.img_url]);

    return data as CoachExerciseVersion;
  }

  /**
   * Drop the coach's version, or just its image.
   *
   * Deleting the whole version is how a coach goes back to the catalogue, so a
   * missing row is success, not an error: the end state they asked for is the
   * end state they get.
   */
  async deleteCoachVersion(
    exerciseId: string,
    coachId: string,
    part: 'image' | 'all' = 'all',
  ) {
    const existing = await this.findCoachVersion(exerciseId, coachId);
    if (!existing) return { message: 'No coach version to delete' };

    if (part === 'image') {
      const { error } = await this.supabase
        .from('exercise_coach_versions')
        .update({ img_url: null, updated_at: new Date().toISOString() })
        .eq('exercise_id', exerciseId)
        .eq('coach_id', coachId);

      if (error) throw new Error(error.message);
      await this.removeStorageObjects([existing.img_url]);
      return { message: 'Coach version image deleted' };
    }

    const { error } = await this.supabase
      .from('exercise_coach_versions')
      .delete()
      .eq('exercise_id', exerciseId)
      .eq('coach_id', coachId);

    if (error) throw new Error(error.message);
    await this.removeStorageObjects([existing.img_url]);
    return { message: 'Coach version deleted' };
  }

  /**
   * Delete storage objects by their public URL, grouped by bucket. Anything
   * that is not a storage URL is skipped rather than guessed at.
   */
  private async removeStorageObjects(
    urls: (string | null | undefined)[],
  ): Promise<void> {
    const locations = urls
      .map((url) => this.parseStorageLocation(url ?? undefined))
      .filter((location): location is { bucket: string; path: string } =>
        Boolean(location),
      );

    if (locations.length === 0) return;

    const bucketMap = new Map<string, string[]>();
    for (const location of locations) {
      const list = bucketMap.get(location.bucket) || [];
      list.push(location.path);
      bucketMap.set(location.bucket, list);
    }

    for (const [bucket, paths] of bucketMap.entries()) {
      const { error } = await this.supabase.storage.from(bucket).remove(paths);
      if (error) throw new Error(error.message);
    }
  }

  /**
   * Catalogue images are landscape by intent — a demonstration frame, shown in
   * a card — so the height is capped harder than the width.
   */
  private compressExerciseImage(imageBuffer: Buffer): Promise<Buffer> {
    return compressImage(imageBuffer, { maxWidth: 1280, maxHeight: 720 });
  }

  // Upload image and video to Supabase storage
  async uploadMedia(
    exerciseId: string,
    imageFile?: { file: Buffer; filename: string },
    videoFile?: { file: Buffer; filename: string; mimetype: string },
  ) {
    const urls: { img_url?: string; video_url?: string } = {};

    try {
      // Upload image if provided
      if (imageFile) {
        const compressedImageBuffer = await this.compressExerciseImage(
          imageFile.file,
        );
        const imagePath = `image-${Date.now()}.webp`;
        const { error: imageError } = await this.supabase.storage
          .from('images')
          .upload(imagePath, compressedImageBuffer, {
            cacheControl: '31536000',
            upsert: false,
            contentType: 'image/webp',
          });

        if (imageError)
          throw new Error(`Image upload failed: ${imageError.message}`);

        const { data: imageUrl } = this.supabase.storage
          .from('images')
          .getPublicUrl(imagePath);

        urls.img_url = imageUrl.publicUrl;
      }

      // Upload video if provided.
      //
      // Stored as it arrives. Re-encoding here would mean ffmpeg in the image
      // and a transcode running inside the request handler, where a large clip
      // blocks a worker for minutes; there is no queue to hand it to. The
      // client compresses before uploading instead — a phone does this on its
      // own hardware for free — and MAX_VIDEO_BYTES on the endpoint is what
      // holds it to that.
      if (videoFile) {
        const videoPath = `exercises/${Date.now()}-${videoFile.filename}`;

        const { error: videoError } = await this.supabase.storage
          .from('videos')
          .upload(videoPath, videoFile.file, {
            // A year: these are immutable once written, and cached egress is
            // the part of the bill that grows with the user count.
            cacheControl: '31536000',
            // The real type, not an assumed one. iOS records QuickTime, and a
            // .mov served as video/mp4 is a player bug waiting to happen.
            contentType: videoFile.mimetype,
            upsert: false,
          });

        if (videoError)
          throw new Error(`Video upload failed: ${videoError.message}`);

        const { data: videoUrl } = this.supabase.storage
          .from('videos')
          .getPublicUrl(videoPath);

        urls.video_url = videoUrl.publicUrl;
      }

      // Update exercise record with media URLs
      if (Object.keys(urls).length > 0) {
        const { error: updateError } = await this.supabase
          .from('exercises')
          .update(urls)
          .eq('id', exerciseId);

        if (updateError)
          throw new Error(`Failed to update exercise: ${updateError.message}`);
      }

      return urls;
    } catch (error: any) {
      // A rejected upload (an image sharp cannot decode, say) already carries
      // the right status; wrapping it in a plain Error would turn a 400 into
      // a 500 and tell the client to retry something that cannot succeed.
      if (error instanceof HttpException) throw error;
      throw new Error(`Media upload error: ${error.message}`);
    }
  }

  // Delete media from exercise
  async deleteMedia(
    exerciseId: string,
    mediaType: 'image' | 'video' | 'both' = 'both',
  ) {
    const { data: media, error: mediaError } = await this.supabase
      .from('exercises')
      .select('img_url, video_url')
      .eq('id', exerciseId)
      .single();
    if (mediaError)
      throw new Error(`Failed to fetch exercise: ${mediaError.message}`);

    const updateData: { img_url?: null; video_url?: null } = {};
    const locations: { bucket: string; path: string }[] = [];

    if ((mediaType === 'image' || mediaType === 'both') && media?.img_url) {
      const imageLocation = this.parseStorageLocation(media.img_url);
      if (imageLocation) locations.push(imageLocation);
      updateData.img_url = null;
    }

    if ((mediaType === 'video' || mediaType === 'both') && media?.video_url) {
      const videoLocation = this.parseStorageLocation(media.video_url);
      if (videoLocation) locations.push(videoLocation);
      updateData.video_url = null;
    }

    if (locations.length === 0) {
      throw new Error(`No ${mediaType} media found for this exercise`);
    }

    // Delete from storage
    const bucketMap = new Map<string, string[]>();
    for (const location of locations) {
      const list = bucketMap.get(location.bucket) || [];
      list.push(location.path);
      bucketMap.set(location.bucket, list);
    }

    for (const [bucket, paths] of bucketMap.entries()) {
      const { data, error: storageError } = await this.supabase.storage
        .from(bucket)
        .remove(paths);

      if (storageError)
        throw new Error(`Storage deletion failed: ${storageError.message}`);
    }

    // Update exercise record
    const { error: updateError } = await this.supabase
      .from('exercises')
      .update(updateData)
      .eq('id', exerciseId);

    if (updateError)
      throw new Error(`Failed to update exercise: ${updateError.message}`);

    return {
      message: `${mediaType} media deleted successfully`,
      deletedPaths: locations.map((loc) => `${loc.bucket}/${loc.path}`),
    };
  }
}
