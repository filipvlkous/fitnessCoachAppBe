import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { UpdateCoachProfileDto } from './dto/coachProfile.dto';
import { SearchCoachProfilesDto } from './dto/searchCoach.dto';
import sharp from 'sharp';

export interface CoachProfile {
  id: string;
  coach_id: string;
  specialty: string | null;
  hourly_rate: number;
  bio: string | null;
  gym: string | null;
  lat: number | null;
  lng: number | null;
  contact: string | null;
  price_list: Array<{
    id: string;
    service: string;
    duration: string;
    price: number;
    salePercent: number;
  }>;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class CoachProfileService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getProfile(coachId: string): Promise<CoachProfile> {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_profiles')
      .select('*')
      .eq('coach_id', coachId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Row not found — return empty defaults
        return this.buildEmptyProfile(coachId);
      }
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  async upsertProfile(
    coachId: string,
    dto: UpdateCoachProfileDto,
  ): Promise<CoachProfile> {
    const payload = {
      coach_id: coachId,
      specialty: dto.specialty ?? null,
      hourly_rate: dto.hourlyRate ?? 0,
      bio: dto.bio ?? null,
      gym: dto.gym ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      contact: dto.contact ?? null,
      price_list: dto.priceList ?? [],
      is_visible: dto.isVisible ?? true,
      email: dto.email ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabaseService.supabase
      .from('coach_profiles')
      .upsert(payload, { onConflict: 'coach_id' })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  // Used by clients discovering a coach (no auth required beyond knowing coach_id)
  async getPublicProfile(coachId: string): Promise<Partial<CoachProfile>> {
    // Fetch base profile
    const { data: profileData, error: profileError } =
      await this.supabaseService.supabase
        .from('coach_profiles')
        .select(
          'coach_id, specialty, hourly_rate, bio, gym, lat, lng, contact, price_list, user:coach_id(id, first_name, last_name, coach_code), avatar_url, gallery_images, email',
        )
        .eq('coach_id', coachId)
        .single();

    if (profileError) {
      if (profileError.code === 'PGRST116') {
        throw new NotFoundException(`Coach profile not found`);
      }
      throw new InternalServerErrorException(profileError.message);
    }

    // Fetch stats from the view
    const { data: statsData, error: statsError } =
      await this.supabaseService.supabase
        .from('coach_profiles_with_stats')
        .select('avg_rating, review_count')
        .eq('coach_id', coachId)
        .single();

    if (statsError && statsError.code !== 'PGRST116') {
      throw new InternalServerErrorException(statsError.message);
    }

    const result = {
      ...profileData,
      avg_rating: statsData?.avg_rating ?? null,
      review_count: statsData?.review_count ?? 0,
    };

    return result;
  }

  async searchProfiles(dto: SearchCoachProfilesDto) {
    const {
      name,
      location,
      minPrice,
      maxPrice,
      minRating,
      limit = 20,
      offset = 0,
    } = dto;

    // Start from a view/RPC that already has avg_rating & review_count joined.
    // If you don't have the view yet, see the migration snippet below.
    let query = this.supabaseService.supabase
      .from('coach_profiles_with_stats') // ← view defined in migration below
      .select(
        `coach_id,
       specialty,
       hourly_rate,
       first_name,
       last_name,
       gym,
       avatar_url,
       avg_rating,
       review_count`,
      )
      .range(offset, offset + limit - 1)
      .eq('is_visible', true);

    // ── free-text: specialty / bio / gym ──────────────────────────────────
    if (name) {
      // ilike on multiple columns using Supabase's `or` filter
      query = query.or(
        `specialty.ilike.%${name}%,bio.ilike.%${name}%,gym.ilike.%${name}%`,
      );
    }

    // ── location (gym address) ────────────────────────────────────────────
    if (location) {
      query = query.ilike('gym', `%${location}%`);
    }

    // ── price range ───────────────────────────────────────────────────────
    if (minPrice !== undefined) {
      query = query.gte('hourly_rate', minPrice);
    }
    if (maxPrice !== undefined) {
      query = query.lte('hourly_rate', maxPrice);
    }

    // ── minimum average rating ────────────────────────────────────────────
    if (minRating !== undefined) {
      query = query.gte('avg_rating', minRating);
    }

    // ── default sort: highest rated first, then cheapest ─────────────────
    query = query
      .order('avg_rating', { ascending: false, nullsFirst: false })
      .order('hourly_rate', { ascending: true });

    const { data, error, count } = await query;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    };
  }

  private buildEmptyProfile(coachId: string): CoachProfile {
    return {
      id: '',
      coach_id: coachId,
      specialty: null,
      hourly_rate: 0,
      bio: null,
      gym: null,
      lat: null,
      lng: null,
      contact: null,
      price_list: [],
      created_at: '',
      updated_at: '',
    };
  }

  // Add these two methods to CoachProfileService

  async uploadAvatar(
    coachId: string,
    file: Express.Multer.File,
  ): Promise<{ avatarUrl: string }> {
    // Avatars don't need to be huge. 400x400 is plenty for high-DPI screens.
    const processedBuffer = await this.processImage(file.buffer, 400, 400);
    const path = `avatars/${coachId}.webp`; // Changed extension to .webp

    const { error: uploadError } = await this.supabaseService.supabase.storage
      .from('coach-images')
      .upload(path, processedBuffer, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (uploadError)
      throw new InternalServerErrorException(uploadError.message);

    const { data } = this.supabaseService.supabase.storage
      .from('coach-images')
      .getPublicUrl(path);

    await this.supabaseService.supabase
      .from('coach_profiles')
      .update({
        avatar_url: data.publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('coach_id', coachId);

    return { avatarUrl: data.publicUrl };
  }

  async uploadGalleryImages(
    coachId: string,
    files: Express.Multer.File[],
  ): Promise<{ galleryImages: string[] }> {
    const uploadedUrls: string[] = [];

    for (const file of files) {
      // Resize gallery images to a max width (e.g., 1200px) but keep aspect ratio
      const processedBuffer = await this.processImage(file.buffer, 1200);
      const path = `gallery/${coachId}/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;

      const { error } = await this.supabaseService.supabase.storage
        .from('coach-images')
        .upload(path, processedBuffer, {
          contentType: 'image/webp',
          upsert: false,
        });

      if (error) throw new InternalServerErrorException(error.message);

      const { data } = this.supabaseService.supabase.storage
        .from('coach-images')
        .getPublicUrl(path);

      uploadedUrls.push(data.publicUrl);
    }

    // Append new URLs to existing gallery_images array
    const { data: existing } = await this.supabaseService.supabase
      .from('coach_profiles')
      .select('gallery_images')
      .eq('coach_id', coachId)
      .single();

    const merged = [...(existing?.gallery_images ?? []), ...uploadedUrls];

    await this.supabaseService.supabase
      .from('coach_profiles')
      .update({ gallery_images: merged, updated_at: new Date().toISOString() })
      .eq('coach_id', coachId);

    return { galleryImages: uploadedUrls };
  }

  async addReview(
    coachId: string,
    clientId: string,
    rating: number,
    comment?: string,
  ) {
    const { error } = await this.supabaseService.supabase
      .from('coach_reviews')
      .insert({
        coach_id: coachId,
        reviewer_id: clientId,
        rating,
        comment,
      });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
    return true;
  }

  async getReviews(coachId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_reviews')
      .select('rating, comment, created_at')
      .eq('coach_id', coachId);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data;
  }

  private async processImage(
    buffer: Buffer,
    width: number,
    height?: number,
  ): Promise<Buffer> {
    return await sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        withoutEnlargement: true,
      })
      .webp({
        quality: 75, // Good balance of size/quality. Lower to 60 for "smallest possible"
        effort: 6, // Max CPU effort for best compression ratio
        lossless: false,
      })
      .toBuffer();
  }
}
