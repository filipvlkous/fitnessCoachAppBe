import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from 'src/notifications/notifications.service';
import { SupabaseService } from 'src/supabase/supabase.service';
import { UpdateProfileDto } from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getAllUsers(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user') // Assuming the table is named 'user'
      .select('first_name, last_name, id')
      .eq('coach_id', userId)
      .eq('role', 'user');

    if (error) {
      if (error.code === '42703') return [];
      throw new Error(`Error fetching user: ${error.message}`);
    }

    return data;
  }
  async getUserById(userId: string) {
    const { data: user, error } = await this.supabaseService.supabase
      .from('user')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Error fetching user: ${error.message}`);
    }

    if (user.role !== 'user') {
      return user;
    }

    const { data: relations, error: relationError } =
      await this.supabaseService.supabase
        .from('coach_user_relations')
        .select('*')
        .eq('user_id', user.id);

    if (relationError) {
      throw new Error(
        `Error fetching coach relations: ${relationError.message}`,
      );
    }

    return {
      ...user,
      coach_user_relations: relations,
    };
  }

  async getDailyEntries(userId: string, date?: string) {
    // const dateStr = localDateStr(date);

    const { data, error } = await this.supabaseService.supabase
      .from('daily_entries')
      .select('total_calories, total_fat, total_carbs, total_protein')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // PGRST116 is the “no rows” error code when you use .single()
        // throw new Error('No daily goal found for the given date and user.');
        return {
          id: 1,
          total_calories: 0,
          total_fat: 0,
          total_carbs: 0,
          total_protein: 0,
        };
      }
      // throw new Error(`Error fetching daily goal: ${error.message}`);
      return null; // Return null instead of throwing an error
    }

    return data;
  }

  async assignUserToCoach(userId: string, code: string) {
    const { data } = await this.supabaseService.supabase
      .from('user')
      .select('id')
      .eq('coach_code', code)
      .maybeSingle();

    if (!data) throw new BadRequestException('Invalid code');

    // Don't create duplicate requests for the same coach.
    const { data: existing } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .select('id')
      .eq('coach_id', data.id)
      .eq('user_id', userId)
      .in('status', ['pending', 'approved'])
      .limit(1)
      .maybeSingle();

    if (existing) return true;

    const { error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .insert({
        coach_id: data.id,
        user_id: userId,
        status: 'pending',
      });

    if (error) {
      throw new InternalServerErrorException(
        `Error assigning user to coach: ${error.message}`,
      );
    }
    return true;
  }

  async getAssignedUsersToCoach(userId: string, param: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .select(
        `
    id,
    status,
    user:coach_user_relations_user_id_fkey (
      user_id:id,
      first_name,
      last_name,
      email
    )
  `,
      )
      .eq(param, userId)
      .in('status', ['approved', 'pending']);

    if (error) {
      throw new Error(`Error fetching assigned users: ${error.message}`);
    }

    return data;
  }

  private async getRelation(relationId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .select('id, coach_id, user_id, status')
      .eq('id', relationId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Relation not found');
    }
    return data;
  }

  async approveUser(relationId: string, requesterId: string) {
    const relation = await this.getRelation(relationId);
    // Only the coach on the relation can approve it.
    if (relation.coach_id !== requesterId) {
      throw new ForbiddenException('Only the coach can approve this request');
    }

    const userId = relation.user_id;

    const { error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .update({ status: 'approved' })
      .eq('id', relationId);

    if (error) {
      throw new InternalServerErrorException(
        `Error approving user: ${error.message}`,
      );
    }

    // Only create a starter program when the user has no active one;
    // duplicate active programs break the active-program endpoints.
    const { data: existingActive } = await this.supabaseService.supabase
      .from('user_workout_programs')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    let program = existingActive ?? null;
    if (!existingActive) {
      const { data, error: programError } = await this.supabaseService.supabase
        .from('user_workout_programs')
        .insert({
          user_id: userId,
          coach_id: relation.coach_id,
          name: 'First Program',
          start_date: new Date().toISOString().split('T')[0],
          end_date: null,
          status: 'active',
          workout_streek: 0,
        })
        .select()
        .single();

      if (programError) {
        throw new InternalServerErrorException(
          `Error approving user: ${programError.message}`,
        );
      }
      program = data;
    }

    this.notificationsService.notifyUser(userId, {
      title: 'Coach Assignment Approved',
      body: 'Your request to be assigned to the coach has been approved.',
    });
    return program;
  }

  async rejectUser(relationId: string, requesterId: string) {
    const relation = await this.getRelation(relationId);
    // The coach can reject; the user can cancel their own request.
    if (relation.coach_id !== requesterId && relation.user_id !== requesterId) {
      throw new ForbiddenException('Not allowed to modify this request');
    }

    const { data, error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .delete()
      .eq('id', relationId)
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(
        `Error rejecting user: ${error.message}`,
      );
    }
    if (requesterId !== data.user_id) {
      this.notificationsService.notifyUser(data.user_id, {
        title: 'Coach Assignment Rejected',
        body: 'Your request to be assigned to the coach has been rejected.',
      });
    }
    return data;
  }

  async removeCoachRelationByUserId(userId: string, programId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .delete()
      .eq('user_id', userId)
      .select();

    if (error) {
      throw new InternalServerErrorException(
        `Error removing coach relation: ${error.message}`,
      );
    }
    if (!data || data.length === 0) {
      throw new NotFoundException('No coach relation found for this user');
    }

    // Also remove the program days tied to this program.
    const { error: daysError } = await this.supabaseService.supabase
      .from('user_program_days')
      .delete()
      .eq('program_id', programId);

    if (daysError) {
      throw new InternalServerErrorException(
        `Error removing program days: ${daysError.message}`,
      );
    }

    return data;
  }

  async getWeightHistory(userId: string, limit: number = 6) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_weight')
      .select('weight, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Error fetching weight history: ${error.message}`);
    }

    return data;
  }

  async addWeightEntry(userId: string, weight: number) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_weight')
      .insert({
        user_id: userId,
        weight,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error adding weight entry: ${error.message}`);
    }

    return data;
  }

  async deleteUser(userId: string) {
    // auth.admin requires the service-role client (anon key gets a 403).
    const adminClient = this.supabaseService.getAdminClient();

    const { data: authUser, error: fetchError } =
      await adminClient.auth.admin.getUserById(userId);

    if (fetchError || !authUser) {
      throw new NotFoundException(
        `User not found in auth: ${fetchError?.message}`,
      );
    }

    const { error: authError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (authError) {
      throw new InternalServerErrorException(
        `Error deleting user from auth: ${authError.message}`,
      );
    }

    const { error } = await this.supabaseService.supabase
      .from('user')
      .delete()
      .eq('id', userId);

    if (error) {
      throw new Error(`Error deleting user: ${error.message}`);
    }

    return true;
  }

  async updateUserProfile(userId: string, dto: UpdateProfileDto) {
    const update: Record<string, unknown> = {};
    if (dto.weight !== undefined) update.weight = dto.weight;
    if (dto.height !== undefined) update.height = dto.height;
    if (dto.age !== undefined) update.age = dto.age;
    if (dto.sex !== undefined) update.sex = dto.sex;
    if (dto.goal !== undefined) update.goal = dto.goal;
    if (dto.activity_level !== undefined)
      update.activity_level = dto.activity_level;
    if (dto.bio !== undefined) update.bio = dto.bio;

    if (Object.keys(update).length === 0) {
      throw new Error('No fields to update');
    }

    const { data, error } = await this.supabaseService.supabase
      .from('user_profile')
      .upsert({ user_id: userId, ...update }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Error saving user profile: ${error.message}`);
    }

    return data;
  }

  async getUserProfile(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching user profile: ${error.message}`,
      );
    }

    return data; // null when no profile exists
  }

  async getBodyPhotos(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_body_image')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error fetching body photos: ${error.message}`);
    }

    return data;
  }

  async addBodyPhoto(userId: string, file: Express.Multer.File, slot?: string) {
    const fileName = `${userId}/${Date.now()}.jpg`;

    const { error: uploadError } = await this.supabaseService.supabase.storage
      .from('user')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Error uploading photo: ${uploadError.message}`);
    }

    const { data: publicUrlData } = this.supabaseService.supabase.storage
      .from('user')
      .getPublicUrl(fileName);

    const { data, error } = await this.supabaseService.supabase
      .from('user_body_image')
      .insert({
        user_id: userId,
        url: publicUrlData.publicUrl,
        slot: slot && Number.isFinite(Number(slot)) ? Number(slot) : null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error adding body photo: ${error.message}`);
    }

    return data;
  }
}
