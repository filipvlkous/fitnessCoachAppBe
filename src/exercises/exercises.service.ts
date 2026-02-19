// src/exercises/exercises.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/exercises.dto';

@Injectable()
export class ExercisesService {
  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getClient();
  }

  // Create a new exercise
  async create(dto: CreateExerciseDto) {
    const { data, error } = await this.supabase
      .from('exercises')
      .insert(dto)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Get all exercises
  async findAll(muscleGroup?: string) {
    let query = this.supabase.from('exercises').select('*').order('name');

    console.log(muscleGroup, query);
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
    const { data, error } = await this.supabase
      .from('exercises')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Delete exercise
  async remove(id: string) {
    const { error } = await this.supabase
      .from('exercises')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
    return { message: 'Exercise deleted successfully' };
  }

  // Get unique muscle groups
  async getMuscleGroups() {
    const { data, error } = await this.supabase
      .from('exercises')
      .select('muscle_group')
      .order('muscle_group');

    if (error) throw new Error(error.message);

    // Get unique values
    const uniqueGroups = [...new Set(data.map((item) => item.muscle_group))];
    return uniqueGroups;
  }

  // Search exercises by name
  async search(searchTerm: string) {
    const { data, error } = await this.supabase
      .from('exercises')
      .select('*')
      .ilike('name', `%${searchTerm}%`)
      .order('name');

    if (error) throw new Error(error.message);
    return data;
  }
}
