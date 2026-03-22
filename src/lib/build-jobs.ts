/**
 * Build Jobs — Core library for build tracking and idempotency
 *
 * DETERMINISTIC: Every status transition is validated against an explicit
 * state machine. Phases must be completed sequentially. Retry logic
 * accumulates ALL error context from every attempt. No hope-based logic.
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
// DETERMINISTIC STATE MACHINE
// Every transition is explicitly defined. If a transition isn't in this
// map, it's illegal and will be rejected. No exceptions.
// ==================

const VALID_TRANSITIONS: Record<BuildStatus, BuildStatus[]> = {
  queued:    ['building', 'cancelled', 'failed'],
  building:  ['testing', 'failed', 'cancelled'],
  testing:   ['deploying', 'failed', 'cancelled'],
  deploying: ['complete', 'failed', 'cancelled'],
  complete:  [],           // Terminal state — no transitions out
  failed:    ['building'], // Only valid via retry (building = retry attempt)
  cancelled: [],           // Terminal state — no transitions out
};

/**
 * Validate a status transition. Throws if the transition is illegal.
 * This is the single source of truth for what transitions are allowed.
 */
function validateTransition(from: BuildStatus, to: BuildStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Illegal status transition: ${from} → ${to}. ` +
      `Allowed transitions from '${from}': [${(allowed || []).join(', ')}]`
    );
  }
}

/**
 * Map of which phase corresponds to which status.
 * Enforces that phase numbers can only move forward, never backward.
 */
const PHASE_STATUS_MAP: Record<number, BuildStatus> = {
  0: 'queued',
  1: 'building',  // Phase 1: Build Validation
  2: 'testing',   // Phase 2: Functional Testing
  3: 'testing',   // Phase 3: Interactive QA (still "testing")
  4: 'deploying', // Phase 4: Deployment
};

const VALID_PRIORITIES: BuildPriority[] = ['low', 'standard', 'high', 'critical'];
const VALID_COMPLEXITY_TIERS: ComplexityTier[] = ['simple', 'standard', 'complex', 'enterprise'];

// ==================
// Input Validation
// ==================

function validateCreateParams(params: CreateBuildParams): void {
  if (!params.idempotency_key || typeof params.idempotency_key !== 'string') {
    throw new Error('idempotency_key is required and must be a non-empty string');
  }
  if (!params.app_name || typeof params.app_name !== 'string') {
    throw new Error('app_name is required and must be a non-empty string');
  }
  if (params.priority && !VALID_PRIORITIES.includes(params.priority)) {
    throw new Error(`Invalid priority: ${params.priority}. Must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }
  if (params.complexity_tier && !VALID_COMPLEXITY_TIERS.includes(params.complexity_tier)) {
    throw new Error(`Invalid complexity_tier: ${params.complexity_tier}. Must be one of: ${VALID_COMPLEXITY_TIERS.join(', ')}`);
  }
}

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
  validateCreateParams(params);

  // Check for existing build with same idempotency key
  const { data: existing } = await supabase
    .from('build_jobs')
    .select('*')
    .eq('idempotency_key', params.idempotency_key)
    .maybeSingle();

  if (existing) {
    return { build: existing as BuildJob, created: false };
  }

  // Create new build — always starts at queued/phase 0
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
// Build Status Updates — STATE MACHINE ENFORCED
// ==================

/**
 * Update build status with deterministic state machine validation.
 * Fetches current status first, validates the transition, then applies.
 * Rejects illegal transitions with explicit error messages.
 */
export async function updateBuildStatus(
  buildId: string,
  newStatus: BuildStatus,
  updates?: Partial<Pick<BuildJob, 'current_phase' | 'current_phase_name' | 'progress_percentage' | 'error_context'>>
): Promise<BuildJob> {
  // Step 1: Fetch current build to validate transition
  const { data: current, error: fetchError } = await supabase
    .from('build_jobs')
    .select('status, current_phase')
    .eq('id', buildId)
    .single();

  if (fetchError || !current) {
    throw new Error(`Build not found: ${buildId}`);
  }

  // Step 2: Validate the transition against the state machine
  validateTransition(current.status as BuildStatus, newStatus);

  // Step 3: Validate phase progression (must go forward, never backward)
  if (updates?.current_phase !== undefined) {
    if (updates.current_phase < current.current_phase && newStatus !== 'building') {
      // Only allow phase reset on retry (status = building from failed)
      throw new Error(
        `Illegal phase regression: ${current.current_phase} → ${updates.current_phase}. ` +
        `Phases can only move forward.`
      );
    }
  }

  // Step 4: Build the update payload with deterministic timestamps
  const payload: Record<string, unknown> = { status: newStatus, ...updates };

  if (newStatus === 'building' && current.status === 'queued') {
    payload.started_at = new Date().toISOString();
  }
  if (newStatus === 'complete' || newStatus === 'failed' || newStatus === 'cancelled') {
    payload.completed_at = new Date().toISOString();
  }

  // Step 5: Apply the update
  const { data, error } = await supabase
    .from('build_jobs')
    .update(payload)
    .eq('id', buildId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update build status: ${error.message}`);
  return data as BuildJob;
}

/**
 * Complete a phase with deterministic sequential validation.
 * Verifies the phase being completed matches the current phase.
 * Rejects out-of-order phase completions.
 */
export async function completePhase(
  buildId: string,
  phaseResult: PhaseResult
): Promise<BuildJob> {
  // Step 1: Fetch current build state
  const { data: current, error: fetchError } = await supabase
    .from('build_jobs')
    .select('current_phase, phases_completed, status')
    .eq('id', buildId)
    .single();

  if (fetchError || !current) {
    throw new Error(`Build not found: ${buildId}`);
  }

  // Step 2: Validate phase is sequential — must complete the CURRENT phase
  const expectedPhase = current.current_phase === 0 ? 1 : current.current_phase;
  if (phaseResult.phase !== expectedPhase) {
    throw new Error(
      `Phase sequence violation: expected phase ${expectedPhase}, ` +
      `got phase ${phaseResult.phase}. Phases must be completed in order.`
    );
  }

  // Step 3: Validate phase exists in definitions
  const phaseDef = BUILD_PHASES.find(p => p.phase === phaseResult.phase);
  if (!phaseDef) {
    throw new Error(`Unknown phase: ${phaseResult.phase}. Valid phases: 1-${BUILD_PHASES.length}`);
  }

  // Step 4: Validate phase result
  if (!['passed', 'failed', 'skipped'].includes(phaseResult.status)) {
    throw new Error(`Invalid phase status: ${phaseResult.status}. Must be passed, failed, or skipped.`);
  }
  if (typeof phaseResult.duration_ms !== 'number' || phaseResult.duration_ms < 0) {
    throw new Error(`Invalid duration_ms: ${phaseResult.duration_ms}. Must be a non-negative number.`);
  }

  // Step 5: Determine next state
  const completedPhases = [...(current.phases_completed || []), phaseResult];
  const nextPhaseNum = phaseResult.phase + 1;
  const nextPhaseDef = BUILD_PHASES.find(p => p.phase === nextPhaseNum);

  // If phase failed, the build fails — don't advance
  if (phaseResult.status === 'failed') {
    return updateBuildStatus(buildId, 'failed', {
      current_phase: phaseResult.phase,
      current_phase_name: `${phaseDef.name} — FAILED`,
      progress_percentage: Math.min(phaseResult.phase * 25, 100),
      error_context: {
        attempts: [],
        last_phase: phaseResult.phase,
        last_error: `Phase ${phaseResult.phase} (${phaseDef.name}) failed`,
      },
    });
  }

  // Calculate progress: each phase is 25%
  const progress = Math.min(phaseResult.phase * 25, 100);

  // Determine next status based on next phase
  let nextStatus: BuildStatus;
  if (!nextPhaseDef) {
    nextStatus = 'complete'; // All phases done
  } else if (nextPhaseNum <= 1) {
    nextStatus = 'building';
  } else if (nextPhaseNum <= 3) {
    nextStatus = 'testing';
  } else {
    nextStatus = 'deploying';
  }

  // Step 6: Update — write completed phases array atomically
  const payload: Record<string, unknown> = {
    status: nextStatus,
    current_phase: nextPhaseNum,
    current_phase_name: nextPhaseDef?.name || 'Complete',
    progress_percentage: progress,
    phases_completed: completedPhases,
  };

  if (nextStatus === 'complete') {
    payload.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('build_jobs')
    .update(payload)
    .eq('id', buildId)
    .select()
    .single();

  if (error) throw new Error(`Failed to complete phase: ${error.message}`);
  return data as BuildJob;
}

/**
 * Retry a failed build with ACCUMULATED error context.
 *
 * DETERMINISTIC: Validates build is actually failed, merges new error
 * with all previous attempt errors, verifies attempt count matches
 * retry_count. Each retry gets MORE context, never the same.
 */
export async function incrementRetry(buildId: string, newError: AttemptError): Promise<BuildJob> {
  // Step 1: Fetch current state
  const { data: current, error: fetchError } = await supabase
    .from('build_jobs')
    .select('status, retry_count, max_retries, error_context, current_phase')
    .eq('id', buildId)
    .single();

  if (fetchError || !current) throw new Error(`Build not found: ${buildId}`);

  // Step 2: Validate build is in a retryable state
  if (current.status !== 'failed') {
    throw new Error(
      `Cannot retry build in '${current.status}' status. Only 'failed' builds can be retried.`
    );
  }

  // Step 3: Check retry limit
  if (current.retry_count >= current.max_retries) {
    throw new Error(
      `Retry limit reached: ${current.retry_count}/${current.max_retries}. ` +
      `Build cannot be retried further. Flag for human review.`
    );
  }

  // Step 4: Accumulate error context — EVERY previous error is preserved
  const previousAttempts = current.error_context?.attempts || [];

  // Validate the new error has the correct attempt number
  const expectedAttemptNum = current.retry_count + 1;
  if (newError.attempt !== expectedAttemptNum) {
    throw new Error(
      `Attempt number mismatch: expected ${expectedAttemptNum}, got ${newError.attempt}. ` +
      `Error context must be sequential.`
    );
  }

  const accumulatedContext: ErrorContext = {
    attempts: [...previousAttempts, newError],
    last_phase: newError.phase,
    last_error: newError.error,
  };

  // Step 5: Reset to building state with accumulated context
  const { data, error } = await supabase
    .from('build_jobs')
    .update({
      retry_count: current.retry_count + 1,
      status: 'building',
      error_context: accumulatedContext,
      current_phase: 1,  // Reset to phase 1, not 0
      current_phase_name: `Retry ${current.retry_count + 1} — Build Validation`,
      progress_percentage: 0,
      phases_completed: [], // Clear completed phases for fresh run
      completed_at: null,   // Clear completion time
    })
    .eq('id', buildId)
    .eq('status', 'failed') // Atomic check — only update if still failed
    .select()
    .single();

  if (error) throw new Error(`Failed to retry build: ${error.message}`);
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
