/**
 * Build Jobs — Core library for build tracking and idempotency
 *
 * Handles build creation with idempotency keys, status tracking,
 * and progress updates. Foundation for the entire enterprise build system.
 */

import { supabase } from './supabase';

// ==================
// Types
// ==================

export type BuildStatus = 'queued' | 'building' | 'testing' | 'deploying' | 'complete' | 'failed' | 'cancelled';
export type BuildPriority = 'low' | 'standard' | 'high' | 'critical';
export type ComplexityTier = 'simple' | 'standard' | 'complex' | 'enterprise';

export interface BuildJob {
  id: string;
  idempotency_key: string | null;
  user_id: string;
  app_name: string | null;
  app_description: string | null;
  spec: Record<string, unknown> | null;
  status: BuildStatus;
  current_phase: number;
  current_phase_name: string | null;
  phases_completed: PhaseResult[];
  progress_percentage: number;
  error_context: ErrorContext | null;
  retry_count: number;
  max_retries: number;
  priority: BuildPriority;
  complexity_tier: ComplexityTier | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhaseResult {
  phase: number;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  details?: Record<string, unknown>;
}

export interface ErrorContext {
  attempts: AttemptError[];
  last_phase: number;
  last_error: string;
}

export interface AttemptError {
  attempt: number;
  phase: number;
  phase_name: string;
  error: string;
  details?: Record<string, unknown>;
  screenshots?: string[];
  timestamp: string;
}

export interface CreateBuildParams {
  idempotency_key: string;
  app_name: string;
  app_description?: string;
  spec?: Record<string, unknown>;
  priority?: BuildPriority;
  complexity_tier?: ComplexityTier;
}

// ==================
// Build Phase Definitions
// ==================

export const BUILD_PHASES = [
  { phase: 1, name: 'Build Validation', description: 'npm install, TypeScript check, lint, production build' },
  { phase: 2, name: 'Functional Testing', description: 'Playwright automated tests — routes, auth, forms, responsive' },
  { phase: 3, name: 'Interactive QA', description: 'Computer Use full browser QA — clicks, forms, visual inspection' },
  { phase: 4, name: 'Deployment', description: 'Git repo creation, Vercel deployment, environment injection' },
] as const;

// ==================
// Idempotent Build Creation
// ==================

/**
 * Creates a build job with idempotency protection.
 * If a build with the same idempotency_key already exists, returns the existing build.
 * This prevents double-charges from double-clicks, refreshes, or network retries.
 */
export async function createBuildJob(params: CreateBuildParams): Promise<{
  build: BuildJob;
  created: boolean;
}> {
  // Check for existing build with same idempotency key
  const { data: existing } = await supabase
    .from('build_jobs')
    .select('*')
    .eq('idempotency_key', params.idempotency_key)
    .maybeSingle();

  if (existing) {
    return { build: existing as BuildJob, created: false };
  }

  // Create new build
  const { data, error } = await supabase
    .from('build_jobs')
    .insert({
      idempotency_key: params.idempotency_key,
      app_name: params.app_name,
      app_description: params.app_description || null,
      spec: params.spec || null,
      status: 'queued',
      current_phase: 0,
      current_phase_name: 'Queued',
      phases_completed: [],
      progress_percentage: 0,
      priority: params.priority || 'standard',
      complexity_tier: params.complexity_tier || null,
      retry_count: 0,
      max_retries: 3,
    })
    .select()
    .single();

  if (error) {
    // Race condition: another request created it between our check and insert
    if (error.code === '23505') { // unique_violation
      const { data: raceResult } = await supabase
        .from('build_jobs')
        .select('*')
        .eq('idempotency_key', params.idempotency_key)
        .single();

      if (raceResult) {
        return { build: raceResult as BuildJob, created: false };
      }
    }
    throw new Error(`Failed to create build job: ${error.message}`);
  }

  return { build: data as BuildJob, created: true };
}

// ==================
// Build Status Updates
// ==================

export async function updateBuildStatus(
  buildId: string,
  status: BuildStatus,
  updates?: Partial<Pick<BuildJob, 'current_phase' | 'current_phase_name' | 'progress_percentage' | 'error_context'>>
): Promise<BuildJob> {
  const payload: Record<string, unknown> = { status, ...updates };

  if (status === 'building' && !payload.started_at) {
    payload.started_at = new Date().toISOString();
  }
  if (status === 'complete' || status === 'failed') {
    payload.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('build_jobs')
    .update(payload)
    .eq('id', buildId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update build status: ${error.message}`);
  return data as BuildJob;
}

export async function completePhase(
  buildId: string,
  phaseResult: PhaseResult
): Promise<BuildJob> {
  // Get current build to append to phases_completed
  const { data: current } = await supabase
    .from('build_jobs')
    .select('phases_completed')
    .eq('id', buildId)
    .single();

  const completedPhases = [...(current?.phases_completed || []), phaseResult];
  const nextPhase = phaseResult.phase + 1;
  const nextPhaseDef = BUILD_PHASES.find(p => p.phase === nextPhase);

  // Calculate progress: each phase is 25%
  const progress = Math.min(phaseResult.phase * 25, 100);

  return updateBuildStatus(buildId, nextPhaseDef ? 'testing' : 'complete', {
    current_phase: nextPhase,
    current_phase_name: nextPhaseDef?.name || 'Complete',
    progress_percentage: progress,
  });
}

export async function incrementRetry(buildId: string, errorContext: ErrorContext): Promise<BuildJob> {
  const { data: current } = await supabase
    .from('build_jobs')
    .select('retry_count, max_retries')
    .eq('id', buildId)
    .single();

  if (!current) throw new Error('Build not found');
  if (current.retry_count >= current.max_retries) {
    return updateBuildStatus(buildId, 'failed', { error_context: errorContext });
  }

  const { data, error } = await supabase
    .from('build_jobs')
    .update({
      retry_count: current.retry_count + 1,
      status: 'building',
      error_context: errorContext,
      current_phase: 0,
      current_phase_name: `Retry ${current.retry_count + 1}`,
      progress_percentage: 0,
    })
    .eq('id', buildId)
    .select()
    .single();

  if (error) throw new Error(`Failed to increment retry: ${error.message}`);
  return data as BuildJob;
}

// ==================
// Build Queries
// ==================

export async function getBuildJob(buildId: string): Promise<BuildJob | null> {
  const { data } = await supabase
    .from('build_jobs')
    .select('*')
    .eq('id', buildId)
    .maybeSingle();

  return data as BuildJob | null;
}

export async function getUserBuilds(
  userId: string,
  options?: { status?: BuildStatus; limit?: number; offset?: number }
): Promise<BuildJob[]> {
  let query = supabase
    .from('build_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.status) query = query.eq('status', options.status);
  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.range(options.offset, options.offset + (options.limit || 10) - 1);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch builds: ${error.message}`);
  return (data || []) as BuildJob[];
}

export async function getActiveBuild(userId: string): Promise<BuildJob | null> {
  const { data } = await supabase
    .from('build_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['queued', 'building', 'testing', 'deploying'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as BuildJob | null;
}

// ==================
// Idempotency Key Generation
// ==================

/**
 * Generate a client-side idempotency key.
 * Call this once when the user clicks "Build" — reuse the same key for retries.
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}
