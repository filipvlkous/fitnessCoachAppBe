import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CoachPlansService } from './coach-plans.service';
import { ApplyDraftDto, DraftProgramDto } from './dto/program-draft.dto';
import { PresetDayDto } from './dto/coach-preset.dto';

const GEMINI_MODEL = 'gemini-3-flash-preview';

/** Bounds the draft is held to, whatever the model returns. */
const MAX_EXERCISES_PER_DAY = 10;
const MAX_SETS = 20;
const MAX_REPS = 100;
const MAX_REST_SECONDS = 600;

/** Just enough of what the library service hands back to point a preset at it. */
interface CreatedPlan {
  id: string;
}

interface CatalogRow {
  id: string;
  name: string;
  muscle_group: string | null;
}

export interface DraftExercise {
  exerciseId: string;
  /** Resolved from the catalog, so the review screen needs no second fetch. */
  name: string;
  muscleGroup: string | null;
  sets: number;
  reps: number;
  restSeconds: number;
  notes: string;
}

export interface DraftDay {
  dayNumber: number;
  name: string;
  /** One line on what the day is for, shown above its exercises. */
  focus: string;
  notes: string;
  exercises: DraftExercise[];
}

export interface ProgramDraft {
  name: string;
  description: string;
  /** What the coach has to decide for themselves before using this. */
  coachNotes: string;
  days: DraftDay[];
  /**
   * What was thrown away between the model and this response. Shown to the
   * coach: a draft that silently lost a day is worse than one that says so.
   */
  warnings: string[];
}

interface RawExercise {
  exerciseId?: string;
  sets?: number;
  reps?: number;
  restSeconds?: number;
  notes?: string;
}

interface RawDay {
  dayNumber?: number;
  name?: string;
  focus?: string;
  notes?: string;
  exercises?: RawExercise[];
}

interface RawDraft {
  name?: string;
  description?: string;
  coachNotes?: string;
  days?: RawDay[];
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Drafting a training week from a sentence.
 *
 * The model picks from this gym's own exercise catalog and nothing else — the
 * response carries ids, every one is checked against the catalog, and anything
 * invented is dropped rather than quietly swapped for something similar. A
 * draft that cannot be saved is worse than a shorter one, and a coach who is
 * not told what went missing cannot catch the difference.
 *
 * Nothing is written until the coach approves. `apply` takes back whatever they
 * edited — not what was generated — and builds it out of the same day plans and
 * presets the library is already made of, so every existing editor works on it
 * from that moment on.
 */
@Injectable()
export class ProgramDraftService {
  private readonly logger = new Logger(ProgramDraftService.name);
  private genAI: GoogleGenAI;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly coachPlansService: CoachPlansService,
  ) {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  private get supabase() {
    return this.supabaseService.getClient();
  }

  async draft(dto: DraftProgramDto): Promise<ProgramDraft> {
    const catalog = await this.fetchCatalog();
    if (catalog.length === 0) {
      throw new ServiceUnavailableException(
        'The exercise catalog is empty, so there is nothing to build a program from.',
      );
    }

    const raw = await this.generate(dto, catalog);
    return this.validate(raw, dto, catalog);
  }

  /**
   * Turn an approved draft into library entries: one day plan per day, then a
   * preset laying those plans across the week.
   *
   * The plans are created first because the preset has to point at them. If the
   * preset then fails, the plans are deleted again — a coach who was told the
   * save failed must not find half of it in their library afterwards.
   */
  async apply(
    coachId: string,
    dto: ApplyDraftDto,
  ): Promise<Record<string, unknown>> {
    const planIds: string[] = [];

    try {
      const days: PresetDayDto[] = [];
      for (const day of dto.days) {
        const plan = (await this.coachPlansService.createPlan(coachId, {
          name: day.name,
          description: dto.name,
          notes: day.notes,
          exercises: day.exercises.map((exercise, index) => ({
            exercise_id: exercise.exerciseId,
            planned_sets: exercise.sets,
            planned_reps: exercise.reps,
            rest_seconds: exercise.restSeconds,
            sort_order: index,
            notes: exercise.notes,
          })),
        })) as CreatedPlan;

        planIds.push(plan.id);
        days.push({
          plan_id: plan.id,
          day_number: day.dayNumber,
          day_name: day.name,
        });
      }

      return (await this.coachPlansService.createPreset(coachId, {
        name: dto.name,
        description: dto.description,
        days,
      })) as Record<string, unknown>;
    } catch (error) {
      for (const planId of planIds) {
        await this.coachPlansService
          .deletePlan(planId)
          .catch((err: Error) =>
            this.logger.error(
              `Rolling back drafted plan ${planId} failed: ${err.message}`,
            ),
          );
      }
      throw error;
    }
  }

  private async fetchCatalog(): Promise<CatalogRow[]> {
    const { data, error } = await this.supabase
      .from('exercises')
      .select('id, name, muscle_group')
      .order('muscle_group', { ascending: true })
      .returns<CatalogRow[]>();

    if (error) {
      throw new InternalServerErrorException(
        `Error fetching the exercise catalog: ${error.message}`,
      );
    }

    return data ?? [];
  }

  private async generate(
    dto: DraftProgramDto,
    catalog: CatalogRow[],
  ): Promise<RawDraft> {
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description:
            'Name of the training week, at most 6 words, naming the goal and the split, e.g. "Hypertrofie – 4denní split".',
        },
        description: {
          type: Type.STRING,
          description:
            'For the coach: what this week is, and how to progress it across the whole phase the brief asks for (which week adds load, sets or reps). 3-5 sentences.',
        },
        coachNotes: {
          type: Type.STRING,
          description:
            'What the coach has to decide themselves: which exercises were avoided because of the brief and why, and what to check with the client before starting. Never medical advice.',
        },
        days: {
          type: Type.ARRAY,
          description: 'One entry per training day.',
          items: {
            type: Type.OBJECT,
            properties: {
              dayNumber: {
                type: Type.INTEGER,
                description:
                  'Weekday slot, 1 = Monday … 7 = Sunday. Unique across the days, spaced so hard sessions are not back to back.',
              },
              name: {
                type: Type.STRING,
                description:
                  'Short name of the session, e.g. "Push A" or "Nohy a core".',
              },
              focus: {
                type: Type.STRING,
                description:
                  'One short line on what the day trains, for the review screen.',
              },
              notes: {
                type: Type.STRING,
                description:
                  'Cues and progression for this session, 1-2 sentences.',
              },
              exercises: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    exerciseId: {
                      type: Type.STRING,
                      description:
                        'The id of an exercise from the CATALOG. Never anything else.',
                    },
                    sets: { type: Type.INTEGER },
                    reps: { type: Type.INTEGER },
                    restSeconds: { type: Type.INTEGER },
                    notes: {
                      type: Type.STRING,
                      description:
                        'Optional short cue for this exercise. May be empty.',
                    },
                  },
                  required: ['exerciseId', 'sets', 'reps', 'restSeconds'],
                },
              },
            },
            required: ['dayNumber', 'name', 'focus', 'notes', 'exercises'],
          },
        },
      },
      required: ['name', 'description', 'coachNotes', 'days'],
    };

    const catalogBlock = catalog
      .map((row) => `${row.id} | ${row.name} | ${row.muscle_group ?? '-'}`)
      .join('\n');

    const lengthBlock = dto.sessionMinutes
      ? `Each session must fit ${dto.sessionMinutes} minutes including rest.`
      : 'Keep sessions to a sensible length for the level in the brief.';

    return this.callGemini<RawDraft>(
      responseSchema,
      `
      CATALOG (id | name | muscle group) — the only exercises that exist:
      ${catalogBlock}

      COACH'S BRIEF: ${dto.brief}
      TRAINING DAYS PER WEEK: ${dto.daysPerWeek}
      ${lengthBlock}

      TASK: Draft one training week the coach can edit and save. It is a weekly template that will be reused for the whole phase, so the progression across the phase belongs in the description and in the day notes, not in extra weeks.

      RULES:
      - Every exerciseId MUST be copied exactly from the CATALOG above. Never invent an id, and never name an exercise that is not in it.
      - Produce exactly ${dto.daysPerWeek} day(s), each on a different weekday, spaced so the same muscles are not trained on consecutive days.
      - At most ${MAX_EXERCISES_PER_DAY} exercises per day, ordered as they should be performed: compound lifts before isolation.
      - Sets, reps and rest must match the goal in the brief (strength, hypertrophy, endurance) and the level of the trainee.
      - Where the brief mentions pain, an injury or a limitation, leave out the exercises that load it and say in coachNotes what you left out and why. Do not diagnose, do not promise it is safe, and do not prescribe rehab — the coach decides.
      - If the catalog has nothing suitable for a slot, leave that slot out instead of substituting something that loads the limitation.
      - Respond in Czech language.
    `,
    );
  }

  /**
   * Everything between the model and the coach.
   *
   * The draft is only worth showing if it can be saved, so this drops what the
   * database would reject — unknown exercise ids, empty days, duplicate
   * weekdays — and records each drop as a warning instead of papering over it.
   */
  private validate(
    raw: RawDraft,
    dto: DraftProgramDto,
    catalog: CatalogRow[],
  ): ProgramDraft {
    const byId = new Map(catalog.map((row) => [row.id, row]));
    const warnings: string[] = [];
    const usedDayNumbers = new Set<number>();
    const days: DraftDay[] = [];

    for (const rawDay of raw.days ?? []) {
      const exercises: DraftExercise[] = [];

      for (const rawExercise of rawDay.exercises ?? []) {
        const known = rawExercise.exerciseId
          ? byId.get(rawExercise.exerciseId)
          : undefined;

        if (!known) {
          warnings.push(
            `V dni „${rawDay.name ?? '?'}“ byl vynechán cvik, který není v katalogu.`,
          );
          continue;
        }
        if (exercises.length >= MAX_EXERCISES_PER_DAY) break;

        exercises.push({
          exerciseId: known.id,
          name: known.name,
          muscleGroup: known.muscle_group,
          sets: clampInt(rawExercise.sets, 1, MAX_SETS, 3),
          reps: clampInt(rawExercise.reps, 1, MAX_REPS, 10),
          restSeconds: clampInt(
            rawExercise.restSeconds,
            0,
            MAX_REST_SECONDS,
            90,
          ),
          notes: (rawExercise.notes ?? '').trim(),
        });
      }

      if (exercises.length === 0) {
        warnings.push(
          `Den „${rawDay.name ?? '?'}“ zůstal bez cviků, a tak byl vynechán.`,
        );
        continue;
      }

      // A preset holds one plan per weekday, so a repeated or out-of-range slot
      // would be rejected on save. Take the next free weekday instead of
      // failing the whole draft over a number.
      let dayNumber = clampInt(rawDay.dayNumber, 1, 7, 0);
      if (dayNumber === 0 || usedDayNumbers.has(dayNumber)) {
        dayNumber = this.nextFreeDay(usedDayNumbers);
      }
      if (dayNumber === 0) {
        warnings.push(
          `Den „${rawDay.name ?? '?'}“ se do týdne nevešel a byl vynechán.`,
        );
        continue;
      }
      usedDayNumbers.add(dayNumber);

      days.push({
        dayNumber,
        name: (rawDay.name ?? `Den ${dayNumber}`).trim(),
        focus: (rawDay.focus ?? '').trim(),
        notes: (rawDay.notes ?? '').trim(),
        exercises,
      });
    }

    if (days.length === 0) {
      throw new ServiceUnavailableException(
        'The draft came back without a single usable training day. Try rephrasing the brief.',
      );
    }
    if (days.length !== dto.daysPerWeek) {
      warnings.push(
        `Bylo vygenerováno ${days.length} tréninkových dnů místo ${dto.daysPerWeek}.`,
      );
    }

    days.sort((a, b) => a.dayNumber - b.dayNumber);

    return {
      name: (raw.name ?? 'Nový program').trim(),
      description: (raw.description ?? '').trim(),
      coachNotes: (raw.coachNotes ?? '').trim(),
      days,
      warnings,
    };
  }

  private nextFreeDay(used: Set<number>): number {
    for (let day = 1; day <= 7; day++) {
      if (!used.has(day)) return day;
    }
    return 0;
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
            temperature: 0.6,
            responseMimeType: 'application/json',
            responseSchema,
            systemInstruction:
              'You are an experienced strength and conditioning coach drafting a training week for another coach to review, edit and approve.',
          },
          contents,
        });

        if (!response?.text) throw new Error('AI returned an empty response.');
        return JSON.parse(response.text) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient =
          /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(503|429)/.test(message);
        if (transient && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }

        this.logger.error(`Program draft generation failed: ${message}`);
        throw new ServiceUnavailableException(
          `Program draft generation failed: ${message}`,
        );
      }
    }
  }
}
