import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { SupabaseService } from 'src/supabase/supabase.service';
import {
  COACH_DATA_SCOPES,
  COACH_SCOPE_KIND,
  CoachDataScope,
  CONSENT_KEYS,
  CONSENT_KIND,
  ConsentKey,
  isImplausibleBirthDate,
  meetsMinimumAge,
  MIN_AGE_YEARS,
  parseIsoDate,
} from './consent.constants';
import {
  ConsentPayload,
  ConsentRecordDto,
  SaveConsentsDto,
} from './dto/consent.dto';
import { BecomeCoachDto, UpdateProfileDto } from './dto/user.dto';

/** Consent columns on the `user` row. */
interface ConsentStateRow {
  date_of_birth: string | null;
  consent_terms_version: string | null;
  consent_policy_version: string | null;
}

/** A row of the `user_consents_current` view. */
interface CurrentConsentRow {
  kind: string;
  consent_key: string;
  granted: boolean;
  decided_at: string | null;
  policy_version: string;
}

/** A row on its way into the ledger. */
interface ConsentEventRow {
  user_id: string;
  kind: string;
  consent_key: string;
  granted: boolean;
  decided_at: string;
  policy_version: string;
  terms_version: string | null;
}

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

    // The program is created before the relation is flipped. The other way
    // round, a failing insert left the athlete approved in the database while
    // the coach was told the approval had failed — accepted on one screen,
    // still pending on the other, and no retry could reconcile it. This order
    // makes the whole call safe to repeat: nothing changes until it works.
    //
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

    const { error } = await this.supabaseService.supabase
      .from('coach_user_relations')
      .update({ status: 'approved' })
      .eq('id', relationId);

    if (error) {
      throw new InternalServerErrorException(
        `Error approving user: ${error.message}`,
      );
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

  async removeCoachRelationByUserId(userId: string, programId?: string) {
    // The chat goes with the relation. This removes every relation the user
    // has, and `chat_messages` is keyed by the coach/client pair rather than by
    // the relation row, so every message where they are the client belongs to a
    // relation about to disappear. Deleted first: a failure here leaves the
    // relation in place and the call retryable, where messages left behind
    // would resurface in the chat if the two ever connect again.
    const { error: chatError } = await this.supabaseService.supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', userId);

    if (chatError) {
      throw new InternalServerErrorException(
        `Error removing chat history: ${chatError.message}`,
      );
    }

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

    // Also remove the program days tied to this program. Skipped when the
    // caller has no program to name (the coach may have deleted it already);
    // an empty id would reach Postgres as an invalid uuid and 500 the request
    // *after* the relation row is gone.
    if (programId) {
      const { error: daysError } = await this.supabaseService.supabase
        .from('user_program_days')
        .delete()
        .eq('program_id', programId);

      if (daysError) {
        throw new InternalServerErrorException(
          `Error removing program days: ${daysError.message}`,
        );
      }
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

  private generateCoachCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(6);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  async becomeCoach(userId: string, dto: BecomeCoachDto) {
    const update: Record<string, unknown> = {
      role: dto.role,
      first_name: dto.first_name,
      last_name: dto.last_name,
    };
    if (dto.role === 'coach') {
      update.coach_code = this.generateCoachCode();
    }

    const { data, error } = await this.supabaseService.supabase
      .from('user')
      .update(update)
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Error updating user to coach: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException('User not found');
    }

    return data;
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

  /**
   * Current consent state, or null when this user has never recorded anything —
   * which is what sends the app to the consent screen after a reinstall.
   *
   * Reads the `user_consents_current` view rather than the ledger itself: the
   * ledger grows with every decision, the view is one row per key.
   */
  async getConsents(userId: string): Promise<ConsentPayload | null> {
    const { data: stateData, error: userError } =
      await this.supabaseService.supabase
        .from('user')
        .select('date_of_birth, consent_terms_version, consent_policy_version')
        .eq('id', userId)
        .maybeSingle();

    if (userError) {
      throw new InternalServerErrorException(
        `Error fetching consent state: ${userError.message}`,
      );
    }

    const { data: rowData, error } = await this.supabaseService.supabase
      .from('user_consents_current')
      .select('kind, consent_key, granted, decided_at, policy_version')
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching consents: ${error.message}`,
      );
    }

    const state = stateData as ConsentStateRow | null;
    const rows = (rowData ?? []) as CurrentConsentRow[];

    if (!state?.date_of_birth && rows.length === 0) return null;

    const consents: ConsentPayload['consents'] = {};
    const coachPermissions: ConsentPayload['coachPermissions'] = {};

    for (const row of rows) {
      const decision = {
        granted: row.granted,
        // Postgres renders timestamptz as `+00:00`; the app stores and compares
        // plain ISO strings, so normalize rather than hand back either form.
        decidedAt: row.decided_at
          ? new Date(row.decided_at).toISOString()
          : null,
        policyVersion: row.policy_version,
      };

      if (row.kind === COACH_SCOPE_KIND) {
        coachPermissions[row.consent_key as CoachDataScope] = decision;
      } else {
        consents[row.consent_key as ConsentKey] = decision;
      }
    }

    return {
      dateOfBirth: state?.date_of_birth ?? null,
      termsVersion: state?.consent_terms_version ?? null,
      policyVersion: state?.consent_policy_version ?? null,
      consents,
      coachPermissions,
    };
  }

  /**
   * What a connected coach may actually read about this user, per scope.
   *
   * This is the ANDing the ledger deliberately does not do: a `coachScope` row
   * only means something while the `coachSharing` consent is standing, so
   * withdrawing that one consent closes every scope at once without having to
   * rewrite the individual scope decisions.
   *
   * Fails closed on every unknown: a scope with no recorded decision, a user who
   * never went through the consent screen, or a missing `coachSharing` row all
   * come back false. Silence is not permission.
   */
  async getCoachDataAccess(
    userId: string,
  ): Promise<Record<CoachDataScope, boolean>> {
    const denied = Object.fromEntries(
      COACH_DATA_SCOPES.map((scope) => [scope, false]),
    ) as Record<CoachDataScope, boolean>;

    const { data, error } = await this.supabaseService.supabase
      .from('user_consents_current')
      .select('kind, consent_key, granted')
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching coach permissions: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Pick<
      CurrentConsentRow,
      'kind' | 'consent_key' | 'granted'
    >[];

    const sharing = rows.some(
      (row) =>
        row.kind === CONSENT_KIND &&
        row.consent_key === ('coachSharing' satisfies ConsentKey) &&
        row.granted,
    );
    if (!sharing) return denied;

    for (const row of rows) {
      if (row.kind !== COACH_SCOPE_KIND) continue;
      const scope = row.consent_key as CoachDataScope;
      // Guard against a key the ledger holds but this build does not know.
      if (scope in denied) denied[scope] = row.granted;
    }

    return denied;
  }

  /**
   * Records a set of consent decisions.
   *
   * Two things make this safe to call repeatedly, which matters because the app
   * replays the whole snapshot on every start while a sync is pending:
   *  - decisions are appended, never overwritten, so a withdrawal stays visible
   *    in the history after a later re-grant;
   *  - a replay of a decision already held collapses to a no-op, so retries do
   *    not bury the real history under duplicates.
   */
  async saveConsents(
    userId: string,
    dto: SaveConsentsDto,
  ): Promise<ConsentPayload> {
    // Before anything is written: no age check, no consent.
    const dateOfBirth = await this.resolveDateOfBirth(
      userId,
      dto.dateOfBirth ?? null,
    );

    const update: Record<string, unknown> = {
      date_of_birth: dateOfBirth,
      consent_updated_at: new Date().toISOString(),
    };
    if (dto.termsVersion) update.consent_terms_version = dto.termsVersion;
    if (dto.policyVersion) update.consent_policy_version = dto.policyVersion;

    const { data: updated, error: userError } =
      await this.supabaseService.supabase
        .from('user')
        .update(update)
        .eq('id', userId)
        .select('id')
        .maybeSingle();

    if (userError) {
      throw new InternalServerErrorException(
        `Error saving consent state: ${userError.message}`,
      );
    }
    if (!updated) throw new NotFoundException('User not found');

    const rows: ConsentEventRow[] = [
      ...this.toEventRows(
        userId,
        CONSENT_KIND,
        CONSENT_KEYS,
        dto.consents,
        dto.termsVersion ?? null,
      ),
      ...this.toEventRows(
        userId,
        COACH_SCOPE_KIND,
        COACH_DATA_SCOPES,
        dto.coachPermissions,
        dto.termsVersion ?? null,
      ),
    ];

    if (rows.length > 0) {
      const { error } = await this.supabaseService.supabase
        .from('user_consent_events')
        .upsert(rows, {
          // `ignoreDuplicates` makes this ON CONFLICT DO NOTHING — an insert of
          // a decision we already hold, not an update of one, which the
          // append-only trigger would reject anyway.
          onConflict: 'user_id,kind,consent_key,decided_at',
          ignoreDuplicates: true,
        });

      if (error) {
        throw new InternalServerErrorException(
          `Error recording consent: ${error.message}`,
        );
      }
    }

    const payload = await this.getConsents(userId);
    if (!payload) {
      throw new InternalServerErrorException('Consent was not persisted');
    }
    return payload;
  }

  /**
   * Turns one submitted vocabulary into ledger rows.
   *
   * Iterates the server's own key list rather than the submitted object's keys,
   * so a client cannot widen the vocabulary by inventing a key — the DTO
   * whitelist already strips those, and this makes it structural rather than
   * dependent on the pipe staying configured that way.
   */
  private toEventRows<K extends string>(
    userId: string,
    kind: string,
    keys: readonly K[],
    submitted: Partial<Record<K, ConsentRecordDto>> | undefined,
    termsVersion: string | null,
  ): ConsentEventRow[] {
    if (!submitted) return [];

    return keys.flatMap((key) => {
      const record = submitted[key];
      // No decision timestamp means the user never answered this one, and a
      // non-answer is not something to record.
      if (!record?.decidedAt) return [];
      return [
        {
          user_id: userId,
          kind,
          consent_key: key,
          granted: record.granted,
          decided_at: new Date(record.decidedAt).toISOString(),
          policy_version: record.policyVersion,
          terms_version: termsVersion,
        },
      ];
    });
  }

  /**
   * Resolves the birth date to record and enforces the age gate on it.
   *
   * Falls back to the stored value so a settings toggle, which sends whatever
   * the app happens to hold, cannot quietly clear a birth date we already have.
   * The gate runs on the stored value too — a row written before this check
   * existed gets validated the first time it is touched.
   */
  private async resolveDateOfBirth(
    userId: string,
    submitted: string | null,
  ): Promise<string> {
    let value = submitted;

    if (!value) {
      const { data } = await this.supabaseService.supabase
        .from('user')
        .select('date_of_birth')
        .eq('id', userId)
        .maybeSingle();
      value =
        (data as Pick<ConsentStateRow, 'date_of_birth'> | null)
          ?.date_of_birth ?? null;
    }

    if (!value) {
      throw new BadRequestException(
        'dateOfBirth is required: consent cannot be recorded without an age check',
      );
    }

    const dob = parseIsoDate(value);
    if (!dob) {
      throw new BadRequestException('dateOfBirth is not a real calendar date');
    }

    const now = new Date();
    if (isImplausibleBirthDate(dob, now)) {
      throw new BadRequestException(
        'dateOfBirth is not a plausible birth date',
      );
    }

    if (!meetsMinimumAge(dob, now)) {
      throw new ForbiddenException(
        `Consent cannot be recorded: users must be at least ${MIN_AGE_YEARS} years old`,
      );
    }

    return value;
  }
}
