import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SetMacrosDto } from './dto/macros.dto';
import { UpdateMealDto } from './dto/meal-edit.dto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { getDayName } from 'utils/dayName';
import { localDateStr } from 'utils/getLocalTime';
import { ingredientRows, mealTotals } from 'utils/mealTotals';

/**
 * Changes — edits and removals together — a user may make to already-logged
 * meals in one local day.
 *
 * The cap exists because a food log people can rewrite freely is not a record
 * of what they ate: a coach reviewing the week has no way to tell a corrected
 * portion from a tidied-up one. Three is enough for the honest case (a wrong
 * amount, a duplicate scan, a meal logged on the wrong day) without turning
 * the log into a draft.
 */
export const MEAL_EDIT_DAILY_LIMIT = 3;

export interface MealEditQuota {
  limit: number;
  used: number;
  remaining: number;
  /** The local day the allowance belongs to, as "YYYY-MM-DD". */
  day: string;
}

@Injectable()
export class MacrosService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getUserMacros(userId: string) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .select('day, calories, protein, carbs, fats')
      .eq('user_id', userId);

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Error fetching getUserMacros macros: ${error.message}`);
    }
    return data;
  }

  async getUserDayMacro(userId: string, day: number) {
    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .select('day, calories, protein, carbs, fats')
      .eq('user_id', userId)
      .eq('day', day)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          day: day,
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0,
        };
      }
      throw new Error(
        `Error fetching getUserDayMacro macros: ${error.message}`,
      );
    }
    return data;
  }

  /**
   * Upserts one weekday's macro targets.
   *
   * `actorId` is who made the change. A user setting their own targets needs
   * no push telling them what they just did — and the client writes a day at a
   * time, so without this a week's worth of edits arrives as seven pushes.
   */
  async setUserMacros(userId: string, macros: SetMacrosDto, actorId?: string) {
    const { day, protein, carbs, fats } = macros;

    // Grams are the source of truth; `calories` is a denormalised copy of
    // them. Deriving it here rather than storing whatever the caller sent is
    // what stops the two drifting apart — a row whose `calories` disagreed
    // with its macros showed one target on the home card and another in the
    // goal editor, since those two read different columns.
    const calories = Math.round(protein * 4 + carbs * 4 + fats * 9);

    const { data, error } = await this.supabaseService.supabase
      .from('user_assigned_macros')
      .upsert(
        { user_id: userId, day, calories, protein, carbs, fats },
        { onConflict: 'user_id,day' },
      );

    if (error) throw new Error(`Error setting macros: ${error.message}`);

    if (actorId !== userId) {
      this.notificationsService.notifyUser(userId, {
        title: 'Macros Updated',
        body: `Your macros for ${getDayName(day)} have been updated.`,
      });
    }
    return data;
  }

  /**
   * One page of the user's meal log, newest first, each meal carrying its
   * ingredient rows. One row past the page is fetched so the caller knows
   * whether more history exists without a second count query.
   *
   * `day` narrows it to a single date ("YYYY-MM-DD"), which is what the day
   * view of the progress calendar reads: paging back through the whole log to
   * find last Tuesday's dinner would cost one request per page of everything
   * in between.
   */
  async getMealHistory(
    userId: string,
    limit: number,
    offset: number,
    day?: string,
  ) {
    let query = this.supabaseService.supabase
      .from('meals')
      .select(
        `id, name, type, meal_time, meal_score, created_at,
         total_calories, total_carbs, total_fat, total_protein, total_weight,
         item_count,
         meal_ingredients ( id, name, weight, unit, calories, protein, carbs, fat,
                            emoji, servings, serving_label, serving_grams )`,
      )
      .eq('user_id', userId);

    if (day) {
      // Half-open range over the stored day, matching `getDailyMacros` — the
      // totals card and the meal list under it have to agree on which meals
      // belong to the day.
      const nextDay = new Date(`${day}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      query = query
        .gte('meal_time', `${day} 00:00:00+00`)
        .lt('meal_time', `${nextDay.toISOString().slice(0, 10)} 00:00:00+00`);
    }

    const { data, error } = await query
      .order('meal_time', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit);

    if (error) {
      throw new Error(`Error fetching meal history: ${error.message}`);
    }

    const rows = data ?? [];
    return { meals: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  /**
   * How many meal changes this user has left today.
   *
   * The day is the user's own (Europe/Prague), not UTC, so the allowance
   * refreshes at their midnight rather than at 02:00.
   */
  async getMealEditQuota(userId: string): Promise<MealEditQuota> {
    const day = localDateStr(new Date());
    const used = await this.countMealEdits(userId, day);

    return {
      limit: MEAL_EDIT_DAILY_LIMIT,
      used,
      remaining: Math.max(0, MEAL_EDIT_DAILY_LIMIT - used),
      day,
    };
  }

  /**
   * Rewrite one logged meal: its name, its type, and the whole ingredient list.
   *
   * `items` replaces the meal's ingredients outright, so removing one row and
   * correcting two amounts are the same request, and the stored totals are
   * always recomputed from what was actually sent.
   */
  async updateMeal(userId: string, mealId: string, dto: UpdateMealDto) {
    const ids = await this.ownedMealIds(
      userId,
      this.mealIdSet(mealId, dto.mergedIds),
      mealId,
    );

    const claimId = await this.claimMealChange(userId, mealId, 'edit');

    try {
      // Captured before anything is written: whatever rows exist now are the
      // ones being replaced, and taking the list up front means a row added by
      // a concurrent request cannot be deleted by this one.
      const replacedIds = await this.ingredientIdsOf(ids);

      // Insert first, delete second. Every step below can fail on its own —
      // there is no transaction across PostgREST calls — so the order is
      // chosen for what a half-applied edit leaves behind: this way the meal
      // is briefly listed twice over, which is visible and fixable by editing
      // again. The reverse order can leave a meal with totals and no
      // ingredients at all, which is unrecoverable.
      const { error: insertError } = await this.supabaseService.supabase
        .from('meal_ingredients')
        .insert(ingredientRows(mealId, dto.items));

      if (insertError) {
        throw new InternalServerErrorException(
          `Error saving meal ingredients: ${insertError.message}`,
        );
      }

      if (replacedIds.length > 0) {
        const { error: deleteError } = await this.supabaseService.supabase
          .from('meal_ingredients')
          .delete()
          .in('id', replacedIds);

        if (deleteError) {
          throw new InternalServerErrorException(
            `Error removing replaced ingredients: ${deleteError.message}`,
          );
        }
      }

      const patch: Record<string, unknown> = mealTotals(dto.items);
      const name = dto.name?.trim();
      if (name) patch.name = name;
      const type = dto.type?.trim();
      if (type) patch.type = type;

      const { error: mealError } = await this.supabaseService.supabase
        .from('meals')
        .update(patch)
        .eq('id', mealId)
        .eq('user_id', userId);

      if (mealError) {
        throw new InternalServerErrorException(
          `Error updating meal: ${mealError.message}`,
        );
      }

      // The siblings' ingredients now live on `mealId`, so the rows themselves
      // are what is left of a dish that was only ever split by an old client.
      const siblings = ids.filter((id) => id !== mealId);
      if (siblings.length > 0) {
        await this.deleteMealRows(userId, siblings);
      }
    } catch (error) {
      await this.refundMealChange(claimId);
      throw error;
    }

    return {
      mealId,
      merged: ids.length - 1,
      quota: await this.getMealEditQuota(userId),
    };
  }

  /**
   * Remove a logged meal. `mergedIds` covers dishes an older client stored as
   * several rows — the user is removing the one entry they can see.
   */
  async deleteMeal(userId: string, mealId: string, mergedIds?: string[]) {
    const ids = await this.ownedMealIds(
      userId,
      this.mealIdSet(mealId, mergedIds),
      mealId,
    );

    const claimId = await this.claimMealChange(userId, mealId, 'delete');

    try {
      await this.deleteMealRows(userId, ids);
    } catch (error) {
      await this.refundMealChange(claimId);
      throw error;
    }

    return { removed: ids.length, quota: await this.getMealEditQuota(userId) };
  }

  /** The meal being changed plus its merged siblings, without duplicates. */
  private mealIdSet(mealId: string, mergedIds?: string[]): string[] {
    return [...new Set([mealId, ...(mergedIds ?? [])])].filter(Boolean);
  }

  /**
   * Narrows a set of ids to the ones this user actually owns, insisting only on
   * `requiredId`.
   *
   * The strictness is deliberately uneven. The meal being changed has to exist
   * and be the caller's — `NotFoundException` rather than a forbidden, so
   * someone probing ids cannot tell "not yours" apart from "no such meal". A
   * merged sibling that has already gone (the client is showing a page it
   * fetched a while ago) is not a reason to refuse the change: it is simply not
   * there to touch.
   */
  private async ownedMealIds(
    userId: string,
    mealIds: string[],
    requiredId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabaseService.supabase
      .from('meals')
      .select('id')
      .eq('user_id', userId)
      .in('id', mealIds);

    if (error) {
      throw new InternalServerErrorException(
        `Error loading meal: ${error.message}`,
      );
    }

    const owned = new Set((data ?? []).map((row) => String(row.id)));
    if (!owned.has(String(requiredId))) {
      throw new NotFoundException('Meal not found');
    }

    // Original order preserved: the required id stays first, which is the meal
    // the rewritten ingredients are attached to.
    return mealIds.filter((id) => owned.has(String(id)));
  }

  private async countMealEdits(userId: string, day: string): Promise<number> {
    const { count, error } = await this.supabaseService.supabase
      .from('meal_edit_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('day', day);

    if (error) {
      throw new InternalServerErrorException(
        `Error reading meal edit quota: ${error.message}`,
      );
    }

    return count ?? 0;
  }

  /**
   * Book one change against today's allowance, returning the ledger row's id
   * so a failed change can hand it back.
   *
   * Written as claim-then-check rather than check-then-write on purpose. Two
   * requests arriving together both pass a "used < 3" read and both spend the
   * same slot; here they both insert, then each asks where its own row sits in
   * the day's order, and only the first three can answer "within the limit".
   * The ordering key is (created_at, id), which every request agrees on.
   */
  private async claimMealChange(
    userId: string,
    mealId: string,
    action: 'edit' | 'delete',
  ): Promise<string> {
    const day = localDateStr(new Date());

    const { data: claim, error } = await this.supabaseService.supabase
      .from('meal_edit_log')
      .insert({ user_id: userId, meal_id: mealId, action, day })
      .select('id')
      .single();

    if (error || !claim) {
      throw new InternalServerErrorException(
        `Error claiming a meal change: ${error?.message ?? 'no row returned'}`,
      );
    }

    const { data: rows, error: readError } = await this.supabaseService.supabase
      .from('meal_edit_log')
      .select('id')
      .eq('user_id', userId)
      .eq('day', day)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (readError) {
      await this.refundMealChange(String(claim.id));
      throw new InternalServerErrorException(
        `Error reading meal edit quota: ${readError.message}`,
      );
    }

    const position = (rows ?? []).findIndex(
      (row) => String(row.id) === String(claim.id),
    );

    if (position < 0 || position >= MEAL_EDIT_DAILY_LIMIT) {
      await this.refundMealChange(String(claim.id));
      const used = await this.countMealEdits(userId, day);

      // 429 rather than 403: nothing about the request is wrong, it is the
      // rate that is — and the client shows "try again tomorrow", not "you are
      // not allowed to do this".
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'MEAL_EDIT_LIMIT_REACHED',
          message: `Only ${MEAL_EDIT_DAILY_LIMIT} meal changes are allowed per day`,
          limit: MEAL_EDIT_DAILY_LIMIT,
          used,
          remaining: 0,
          day,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return String(claim.id);
  }

  /**
   * Hand a claimed slot back when the change it was booked for did not happen.
   * Best effort by design: a failed refund costs the user one of the day's
   * three changes, which is a far better outcome than a failed *change* that
   * also throws away the error the caller needs to see.
   */
  private async refundMealChange(claimId: string): Promise<void> {
    try {
      await this.supabaseService.supabase
        .from('meal_edit_log')
        .delete()
        .eq('id', claimId);
    } catch {
      // Nothing useful to do here; the caller is already throwing.
    }
  }

  private async ingredientIdsOf(mealIds: string[]): Promise<string[]> {
    const { data, error } = await this.supabaseService.supabase
      .from('meal_ingredients')
      .select('id')
      .in('meal_id', mealIds);

    if (error) {
      throw new InternalServerErrorException(
        `Error loading meal ingredients: ${error.message}`,
      );
    }

    return (data ?? []).map((row) => String(row.id));
  }

  /**
   * Ingredients first, then the meals themselves — `meal_ingredients` is not
   * guaranteed to cascade, and a meal deleted out from under its rows would
   * leave them orphaned and still counted by anything that sums the table.
   */
  private async deleteMealRows(
    userId: string,
    mealIds: string[],
  ): Promise<void> {
    const { error: ingredientError } = await this.supabaseService.supabase
      .from('meal_ingredients')
      .delete()
      .in('meal_id', mealIds);

    if (ingredientError) {
      throw new InternalServerErrorException(
        `Error removing meal ingredients: ${ingredientError.message}`,
      );
    }

    const { error: mealError } = await this.supabaseService.supabase
      .from('meals')
      .delete()
      .eq('user_id', userId)
      .in('id', mealIds);

    if (mealError) {
      throw new InternalServerErrorException(
        `Error removing meal: ${mealError.message}`,
      );
    }
  }

  async getDailyMacros(userId: string, date: string) {
    // Half-open range [date, date + 1 day) so no second of the day is missed.
    const nextDay = new Date(`${date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayStr = nextDay.toISOString().slice(0, 10);

    const { data, error } = await this.supabaseService.supabase
      .from('meals')
      .select('total_calories, total_carbs, total_fat, total_protein')
      .eq('user_id', userId)
      .gte('meal_time', `${date} 00:00:00+00`)
      .lt('meal_time', `${nextDayStr} 00:00:00+00`);

    if (error) {
      throw new Error(`Error fetching daily macros: ${error.message}`);
    }

    const totals = (data || []).reduce(
      (acc, meal) => ({
        total_calories: acc.total_calories + (meal.total_calories || 0),
        total_carbs: acc.total_carbs + (meal.total_carbs || 0),
        total_fat: acc.total_fat + (meal.total_fat || 0),
        total_protein: acc.total_protein + (meal.total_protein || 0),
      }),
      { total_calories: 0, total_carbs: 0, total_fat: 0, total_protein: 0 },
    );

    return totals;
  }
}
