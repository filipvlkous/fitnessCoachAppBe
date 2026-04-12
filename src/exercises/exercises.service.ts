// src/exercises/exercises.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/exercises.dto';
import sharp from 'sharp';
import path from 'path';

@Injectable()
export class ExercisesService {
  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  // Create a new exercise
  async create(dto: CreateExerciseDto): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('exercises')
      .insert(dto)
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
  async update(id: string, dto: UpdateExerciseDto) {
    const { error } = await this.supabase
      .from('exercises')
      .update(dto)
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

    const locations = [
      this.parseStorageLocation(media?.img_url),
      this.parseStorageLocation(media?.video_url),
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

  async getMedia(
    exerciseId: string,
    type: 'image' | 'video' | 'both' = 'both',
  ) {
    const { data, error } = await this.supabase
      .from('exercises')
      .select(
        type === 'both'
          ? 'img_url, video_url'
          : type === 'image'
            ? 'img_url'
            : 'video_url',
      )
      .eq('id', exerciseId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  private async compressImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(imageBuffer)
        .resize(1280, 720, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (error: any) {
      console.warn(
        'Image compression failed, uploading original:',
        error.message,
      );
      return imageBuffer;
    }
  }

  // Compress video buffer (basic size check, proper compression needs ffmpeg)
  private async compressVideo(videoBuffer: Buffer): Promise<Buffer> {
    // Note: Full video compression requires ffmpeg
    // For now, we'll just return the buffer if it's under 100MB, else warn
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (videoBuffer.length > maxSize) {
      console.warn(
        `Video size (${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB) exceeds recommended 100MB. Consider using ffmpeg for proper compression.`,
      );
    }
    return videoBuffer;
  }

  // Upload image and video to Supabase storage
  async uploadMedia(
    exerciseId: string,
    imageFile?: { file: Buffer; filename: string },
    videoFile?: { file: Buffer; filename: string },
  ) {
    const urls: { img_url?: string; video_url?: string } = {};

    try {
      // Upload image if provided
      if (imageFile) {
        const compressedImageBuffer = await this.compressImage(imageFile.file);
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

        console.log(imageUrl);
        urls.img_url = imageUrl.publicUrl;
      }

      // Upload video if provided
      if (videoFile) {
        // 1. Move compression to a background worker if possible,
        // but at least ensure we use a stream or optimized buffer.
        const compressedVideoBuffer = await this.compressVideo(videoFile.file);

        // 2. Better Naming: Use a folder structure for organization
        const videoPath = `exercises/${Date.now()}-${videoFile.filename}`;

        const { data: videoData, error: videoError } =
          await this.supabase.storage
            .from('videos')
            .upload(videoPath, compressedVideoBuffer, {
              // 3. MAXIMIZE CACHED EGRESS (1 Year)
              cacheControl: '31536000',
              // 4. HELP THE PLAYER
              contentType: 'video/mp4',
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

    console.log(bucketMap);
    for (const [bucket, paths] of bucketMap.entries()) {
      const { data, error: storageError } = await this.supabase.storage
        .from(bucket)
        .remove(paths);

      console.log(storageError, data);
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
