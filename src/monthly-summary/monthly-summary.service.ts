import { Injectable } from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import { SupabaseService } from 'src/supabase/supabase.service';

export interface MonthStats {
  workouts: number;
  completedWorkouts: number;
  hours: number;
  longestStreakDays: number;
  totalSets: number;
  avgWorkoutDurationMinutes: number | null;
  cardio: {
    sessions: number;
    minutes: number;
    distanceKm: number;
  };
  nutrition: {
    mealsLogged: number;
    daysLogged: number;
    avgDailyCalories: number;
    avgDailyProtein: number;
    avgDailyCarbs: number;
    avgDailyFat: number;
    avgMealScore: number | null;
    targets: {
      calories: number;
      protein: number;
      carbs: number;
      fats: number;
    } | null;
  };
}

export interface MonthReview {
  headline: string;
  summary: string;
  pros: string[];
  cons: string[];
  highlights: string[];
  focus: string[];
}

export interface MonthlySummary {
  month: string;
  previousMonth: string;
  goal: {
    targetSessions: number | null;
    completedSessions: number;
  };
  stats: MonthStats;
  previousStats: MonthStats;
  weeklyActivity: { week: number; current: number; previous: number }[];
  muscleGroups: { name: string; sets: number }[];
  review: MonthReview;
}

interface ExerciseLogRow {
  set_number: number | null;
  weight: number | null;
  reps: number | null;
  exercises:
    | { name: string; muscle_group: string | null }
    | { name: string; muscle_group: string | null }[]
    | null;
}

interface CardioLogRow {
  cardio_type: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  intensity: string | null;
}

interface WorkoutLogRow {
  id: string;
  workout_date: string;
  completed: boolean | null;
  duration_minutes: number | null;
  exercise_logs: ExerciseLogRow[] | null;
  cardio_logs: CardioLogRow[] | null;
}

interface MealRow {
  meal_time: string;
  total_calories: number | null;
  total_protein: number | null;
  total_carbs: number | null;
  total_fat: number | null;
  meal_score: number | null;
}

interface AssignedMacroRow {
  day: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
}

interface ProgramDayRow {
  week_number: number | null;
}

interface CollectedMonth {
  daysInMonth: number;
  workouts: {
    totalWorkouts: number;
    completedWorkouts: number;
    totalDurationMinutes: number;
    avgWorkoutDurationMinutes: number | null;
    longestStreakDays: number;
    totalSets: number;
    setsPerMuscleGroup: Record<string, number>;
  };
  weeklyWorkouts: number[];
  cardio: {
    totalSessions: number;
    totalMinutes: number;
    totalDistanceKm: number;
    sessionsPerType: Record<string, number>;
  };
  nutrition: {
    mealsLogged: number;
    daysWithLoggedMeals: number;
    avgDailyCalories: number;
    avgDailyProtein: number;
    avgDailyCarbs: number;
    avgDailyFat: number;
    avgMealScore: number | null;
    assignedDailyTargets: {
      calories: number;
      protein: number;
      carbs: number;
      fats: number;
    } | null;
  };
}

// Unwraps supabase joined relations that may come back as object or array.
const one = <T>(value: T | T[] | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : (value ?? undefined);

const GEMINI_MODEL = 'gemini-3-flash-preview';

@Injectable()
export class MonthlySummaryService {
  private genAI: GoogleGenAI;

  constructor(private readonly supabaseService: SupabaseService) {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async getMonthlySummary(
    userId: string,
    month: string,
  ): Promise<MonthlySummary> {
    const previousMonth = this.previousMonthOf(month);

    const [current, previous, targetSessions, storedReview] = await Promise.all(
      [
        this.collectMonthStats(userId, month),
        this.collectMonthStats(userId, previousMonth),
        this.fetchSessionGoal(userId, month),
        this.fetchStoredReview(userId, month),
      ],
    );

    const currentEmpty = this.isEmptyMonth(current);
    const previousEmpty = this.isEmptyMonth(previous);

    const review =
      storedReview ??
      (currentEmpty
        ? this.emptyReview(month)
        : await this.generateCurrentReview(
            month,
            current,
            previousMonth,
            previousEmpty ? null : previous,
          ));

    // A closed month's data no longer changes, so its review is generated
    // once and persisted; the running month stays cache-only.
    if (!storedReview && !currentEmpty && this.isClosedMonth(month)) {
      await this.storeReview(userId, month, review);
    }

    return {
      month,
      previousMonth,
      goal: {
        targetSessions,
        completedSessions: current.workouts.completedWorkouts,
      },
      stats: this.toMonthStats(current),
      previousStats: this.toMonthStats(previous),
      weeklyActivity: this.pairWeeklyActivity(
        current.weeklyWorkouts,
        previous.weeklyWorkouts,
      ),
      muscleGroups: Object.entries(current.workouts.setsPerMuscleGroup)
        .map(([name, sets]) => ({ name, sets }))
        .sort((a, b) => b.sets - a.sets),
      review,
    };
  }

  private isEmptyMonth(stats: CollectedMonth): boolean {
    return (
      stats.workouts.totalWorkouts === 0 && stats.nutrition.mealsLogged === 0
    );
  }

  private monthRange(month: string) {
    const [year, monthNum] = month.split('-').map(Number);
    const start = `${month}-01`;
    // First day of the next month (exclusive end).
    const end = new Date(Date.UTC(year, monthNum, 1))
      .toISOString()
      .slice(0, 10);
    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    return { start, end, daysInMonth };
  }

  private previousMonthOf(month: string): string {
    const [year, monthNum] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNum - 2, 1)).toISOString().slice(0, 7);
  }

  // A month is closed once the current UTC month is past it.
  private isClosedMonth(month: string): boolean {
    return month < new Date().toISOString().slice(0, 7);
  }

  private async fetchStoredReview(
    userId: string,
    month: string,
  ): Promise<MonthReview | null> {
    const { data, error } = await this.supabaseService.supabase
      .from('monthly_reviews')
      .select('review')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();

    if (error) {
      // Persistence is an optimization; fall back to generating.
      console.error('Fetching stored monthly review failed:', error.message);
      return null;
    }

    return (data?.review as MonthReview) ?? null;
  }

  private async storeReview(
    userId: string,
    month: string,
    review: MonthReview,
  ): Promise<void> {
    const { error } = await this.supabaseService.supabase
      .from('monthly_reviews')
      .upsert({ user_id: userId, month, review, model: GEMINI_MODEL });

    if (error) {
      console.error('Storing monthly review failed:', error.message);
    }
  }

  private async collectMonthStats(
    userId: string,
    month: string,
  ): Promise<CollectedMonth> {
    const { start, end, daysInMonth } = this.monthRange(month);

    const [
      { data: workoutLogs, error: workoutError },
      { data: meals, error: mealsError },
      { data: assignedMacros, error: macrosError },
    ] = await Promise.all([
      this.supabaseService.supabase
        .from('workout_logs')
        .select(
          `
          id,
          workout_date,
          completed,
          duration_minutes,
          user_workout_programs!inner ( user_id ),
          user_program_days ( day_name ),
          exercise_logs ( set_number, weight, reps, exercises ( name, muscle_group ) ),
          cardio_logs ( cardio_type, duration_minutes, distance_km, intensity )
        `,
        )
        .eq('user_workout_programs.user_id', userId)
        .gte('workout_date', start)
        .lt('workout_date', end)
        .order('workout_date', { ascending: true }),

      this.supabaseService.supabase
        .from('meals')
        .select(
          'meal_time, total_calories, total_fat, total_carbs, total_protein, meal_score',
        )
        .eq('user_id', userId)
        .gte('meal_time', `${start} 00:00:00+00`)
        .lt('meal_time', `${end} 00:00:00+00`),

      this.supabaseService.supabase
        .from('user_assigned_macros')
        .select('day, calories, protein, carbs, fats')
        .eq('user_id', userId),
    ]);

    if (workoutError) {
      throw new Error(`Error fetching workout logs: ${workoutError.message}`);
    }
    if (mealsError) {
      throw new Error(`Error fetching meals: ${mealsError.message}`);
    }
    if (macrosError) {
      throw new Error(`Error fetching assigned macros: ${macrosError.message}`);
    }

    const workoutRows = (workoutLogs ?? []) as unknown as WorkoutLogRow[];
    const workoutDates = workoutRows.map((log) => log.workout_date);

    return {
      daysInMonth,
      workouts: this.aggregateWorkouts(workoutRows, workoutDates),
      weeklyWorkouts: this.workoutsPerWeek(workoutDates, daysInMonth),
      cardio: this.aggregateCardio(workoutRows),
      nutrition: this.aggregateNutrition(
        (meals ?? []) as MealRow[],
        (assignedMacros ?? []) as AssignedMacroRow[],
      ),
    };
  }

  // Monthly session target derived from the active program's days per week.
  private async fetchSessionGoal(
    userId: string,
    month: string,
  ): Promise<number | null> {
    const { data, error } = await this.supabaseService.supabase
      .from('user_program_days')
      .select('week_number, user_workout_programs!inner ( user_id, status )')
      .eq('user_workout_programs.user_id', userId)
      .eq('user_workout_programs.status', 'active');

    if (error) {
      // The goal is decoration on the summary; don't fail the whole endpoint.
      console.error('Fetching session goal failed:', error.message);
      return null;
    }

    const days = (data ?? []) as unknown as ProgramDayRow[];
    if (days.length === 0) return null;

    const weeks = new Set(days.map((d) => d.week_number ?? 1)).size || 1;
    const daysPerWeek = days.length / weeks;
    const { daysInMonth } = this.monthRange(month);
    return Math.round((daysPerWeek * daysInMonth) / 7);
  }

  private aggregateWorkouts(
    workoutLogs: WorkoutLogRow[],
    workoutDates: string[],
  ) {
    let totalSets = 0;
    let totalVolumeKg = 0;
    let totalDurationMinutes = 0;
    const setsPerMuscleGroup: Record<string, number> = {};
    const durations: number[] = [];

    for (const log of workoutLogs) {
      if (log.duration_minutes) {
        durations.push(log.duration_minutes);
        totalDurationMinutes += log.duration_minutes;
      }

      for (const set of log.exercise_logs ?? []) {
        totalSets += 1;
        totalVolumeKg += (set.weight || 0) * (set.reps || 0);

        const muscleGroup = one(set.exercises)?.muscle_group ?? 'unknown';
        setsPerMuscleGroup[muscleGroup] =
          (setsPerMuscleGroup[muscleGroup] || 0) + 1;
      }
    }

    return {
      totalWorkouts: workoutLogs.length,
      completedWorkouts: workoutLogs.filter((log) => log.completed).length,
      totalDurationMinutes,
      avgWorkoutDurationMinutes: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      longestStreakDays: this.longestStreak(workoutDates),
      totalSets,
      totalVolumeKg: Math.round(totalVolumeKg),
      setsPerMuscleGroup,
    };
  }

  // Longest run of consecutive calendar days with at least one workout.
  private longestStreak(dates: string[]): number {
    const uniqueDays = [...new Set(dates)].sort();
    let best = 0;
    let run = 0;
    let previousDay: number | null = null;

    for (const day of uniqueDays) {
      const dayIndex = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
      run = previousDay !== null && dayIndex - previousDay === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      previousDay = dayIndex;
    }

    return best;
  }

  // Workouts bucketed into weeks of the month (days 1-7, 8-14, ...).
  private workoutsPerWeek(dates: string[], daysInMonth: number): number[] {
    const weeks = Math.ceil(daysInMonth / 7);
    const counts = new Array<number>(weeks).fill(0);

    for (const date of dates) {
      const dayOfMonth = Number(date.slice(8, 10));
      const week = Math.min(Math.floor((dayOfMonth - 1) / 7), weeks - 1);
      counts[week] += 1;
    }

    return counts;
  }

  private pairWeeklyActivity(current: number[], previous: number[]) {
    const weeks = Math.max(current.length, previous.length);
    return Array.from({ length: weeks }, (_, i) => ({
      week: i + 1,
      current: current[i] ?? 0,
      previous: previous[i] ?? 0,
    }));
  }

  private aggregateCardio(workoutLogs: WorkoutLogRow[]) {
    const cardioLogs = workoutLogs.flatMap((log) => log.cardio_logs ?? []);
    const sessionsPerType: Record<string, number> = {};

    for (const cardio of cardioLogs) {
      const type = cardio.cardio_type ?? 'unknown';
      sessionsPerType[type] = (sessionsPerType[type] || 0) + 1;
    }

    return {
      totalSessions: cardioLogs.length,
      totalMinutes: cardioLogs.reduce(
        (sum, c) => sum + (c.duration_minutes || 0),
        0,
      ),
      totalDistanceKm:
        Math.round(
          cardioLogs.reduce((sum, c) => sum + (c.distance_km || 0), 0) * 10,
        ) / 10,
      sessionsPerType,
    };
  }

  private aggregateNutrition(
    meals: MealRow[],
    assignedMacros: AssignedMacroRow[],
  ) {
    const loggedDays = new Set(
      meals.map((meal) => String(meal.meal_time).slice(0, 10)),
    );
    const dayCount = loggedDays.size || 1;

    const totals = meals.reduce(
      (acc, meal) => ({
        calories: acc.calories + (meal.total_calories || 0),
        protein: acc.protein + (meal.total_protein || 0),
        carbs: acc.carbs + (meal.total_carbs || 0),
        fat: acc.fat + (meal.total_fat || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const scores = meals
      .map((meal) => meal.meal_score)
      .filter((score): score is number => typeof score === 'number');

    // Average the coach-assigned daily targets so the AI can judge adherence.
    const activeTargets = assignedMacros.filter((m) => (m.calories || 0) > 0);
    const targets = activeTargets.length
      ? {
          calories: Math.round(
            activeTargets.reduce((s, m) => s + (m.calories || 0), 0) /
              activeTargets.length,
          ),
          protein: Math.round(
            activeTargets.reduce((s, m) => s + (m.protein || 0), 0) /
              activeTargets.length,
          ),
          carbs: Math.round(
            activeTargets.reduce((s, m) => s + (m.carbs || 0), 0) /
              activeTargets.length,
          ),
          fats: Math.round(
            activeTargets.reduce((s, m) => s + (m.fats || 0), 0) /
              activeTargets.length,
          ),
        }
      : null;

    return {
      mealsLogged: meals.length,
      daysWithLoggedMeals: loggedDays.size,
      avgDailyCalories: Math.round(totals.calories / dayCount),
      avgDailyProtein: Math.round(totals.protein / dayCount),
      avgDailyCarbs: Math.round(totals.carbs / dayCount),
      avgDailyFat: Math.round(totals.fat / dayCount),
      avgMealScore: scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null,
      assignedDailyTargets: targets,
    };
  }

  private toMonthStats(collected: CollectedMonth): MonthStats {
    const { workouts, cardio, nutrition } = collected;

    return {
      workouts: workouts.totalWorkouts,
      completedWorkouts: workouts.completedWorkouts,
      hours: Math.round((workouts.totalDurationMinutes / 60) * 10) / 10,
      longestStreakDays: workouts.longestStreakDays,
      totalSets: workouts.totalSets,
      avgWorkoutDurationMinutes: workouts.avgWorkoutDurationMinutes,
      cardio: {
        sessions: cardio.totalSessions,
        minutes: cardio.totalMinutes,
        distanceKm: cardio.totalDistanceKm,
      },
      nutrition: {
        mealsLogged: nutrition.mealsLogged,
        daysLogged: nutrition.daysWithLoggedMeals,
        avgDailyCalories: nutrition.avgDailyCalories,
        avgDailyProtein: nutrition.avgDailyProtein,
        avgDailyCarbs: nutrition.avgDailyCarbs,
        avgDailyFat: nutrition.avgDailyFat,
        avgMealScore: nutrition.avgMealScore,
        targets: nutrition.assignedDailyTargets,
      },
    };
  }

  private emptyReview(month: string): MonthReview {
    return {
      headline: 'No data yet',
      summary: `No workouts or meals were logged in ${month}, so there is nothing to review yet.`,
      pros: [],
      cons: ['No training or nutrition data was logged this month.'],
      highlights: [],
      focus: ['Log your workouts', 'Log your meals'],
    };
  }

  private async generateCurrentReview(
    month: string,
    stats: CollectedMonth,
    previousMonth: string,
    previousStats: CollectedMonth | null,
  ): Promise<MonthReview> {
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description:
            'A short, punchy month verdict of at most 4 words, e.g. "Strong month" or "Tough stretch". No client name.',
        },
        summary: {
          type: Type.STRING,
          description:
            "A short 2-3 sentence overview of the client's month, covering training and nutrition.",
        },
        pros: {
          type: Type.ARRAY,
          description:
            'What went well this month. 2-4 short bullet points, each backed by the data like what went like new personal records or improved consistency.',
          items: { type: Type.STRING },
        },
        cons: {
          type: Type.ARRAY,
          description:
            'What needs improvement. 2-4 short bullet points, each backed by the data.',
          items: { type: Type.STRING },
        },
        highlights: {
          type: Type.ARRAY,
          description:
            'The 2-4 most impressive, concrete achievements of the month (streaks, volume, records), each with a number.',
          items: { type: Type.STRING },
        },
        focus: {
          type: Type.ARRAY,
          description:
            'The 2-4 most important action items for next month. Each at most 5 words, imperative, e.g. "Add a pull day".',
          items: { type: Type.STRING },
        },
      },
      required: ['headline', 'summary', 'pros', 'cons', 'highlights', 'focus'],
    };

    const previousBlock = previousStats
      ? `PREVIOUS MONTH (${previousMonth}) DATA FOR COMPARISON: ${JSON.stringify(previousStats)}`
      : 'PREVIOUS MONTH: no data was logged.';

    return this.callGemini<MonthReview>(
      responseSchema,
      `
      MONTH: ${month} (${stats.daysInMonth} days)
      DATA: ${JSON.stringify(stats)}
      ${previousBlock}

      TASK: Review this client's month of training and nutrition. Write a headline, a short summary, pros, cons, the month's highlights and the focus points for next month.

      RULES:
      - Base every statement strictly on the DATA above; never invent numbers.
      - Mention concrete numbers where they help (workouts completed, avg calories, cardio minutes...).
      - Where previous month data exists, compare against it (more/fewer workouts, volume change, logging consistency).
      - If a whole area (e.g. cardio or meals) has no data, call that out as a con instead of guessing.
      - Derive the focus points from the cons and from what dropped versus the previous month.
      - Address the client directly as "you", in a friendly but honest tone.
      - Respond in Czech language.
    `,
    );
  }

  private async callGemini<T>(
    responseSchema: Record<string, unknown>,
    contents: string,
  ): Promise<T> {
    const maxRetries = 2;

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.genAI.models.generateContent({
          model: GEMINI_MODEL,
          config: {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema,
            systemInstruction:
              "You are an experienced fitness and nutrition coach reviewing a client's monthly progress.",
          },
          contents,
        });

        if (!response || !response.text) {
          throw new Error('AI returned an empty response.');
        }

        return JSON.parse(response.text) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Overload/rate-limit errors are usually short spikes; retry with backoff.
        const transient =
          /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(503|429)/.test(message);
        if (transient && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }

        console.error('Monthly summary generation failed:', error);
        throw new Error(`Error generating monthly summary: ${message}`);
      }
    }
  }
}
