/**
 * Build Events — Real-time progress tracking
 *
 * DETERMINISTIC: Events have sequence numbers for guaranteed ordering.
 * Reconnection backfills missed events from the last-seen sequence.
 * Event types are validated before emission. No out-of-order delivery.
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ==================
// Types
// ==================

export const VALID_EVENT_TYPES = [
  'phase_start', 'phase_complete', 'phase_failed',
  'test_start', 'test_pass', 'test_fail',
  'screenshot_captured', 'video_captured',
  'build_complete', 'build_failed',
  'retry_start', 'retry_complete',
  'deploy_start', 'deploy_progress', 'deploy_complete', 'deploy_failed',
  'info', 'warning', 'error',
] as const;

export type BuildEventType = typeof VALID_EVENT_TYPES[number];

export interface BuildEvent {
  id: string;
  build_job_id: string;
  sequence: number;
  event_type: BuildEventType;
  phase: number | null;
  phase_name: string | null;
  message: string | null;
  data: Record<string, unknown> | null;
  screenshot_url: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface EmitEventParams {
  build_job_id: string;
  event_type: BuildEventType;
  phase?: number;
  phase_name?: string;
  message?: string;
  data?: Record<string, unknown>;
  screenshot_url?: string;
  duration_ms?: number;
}

// ==================
// Input Validation
// ==================

function validateEventType(eventType: string): asserts eventType is BuildEventType {
  if (!VALID_EVENT_TYPES.includes(eventType as BuildEventType)) {
    throw new Error(
      `Invalid event type: '${eventType}'. ` +
      `Valid types: ${VALID_EVENT_TYPES.join(', ')}`
    );
  }
}

function validatePhase(phase: number | undefined): void {
  if (phase !== undefined && (phase < 0 || phase > 4 || !Number.isInteger(phase))) {
    throw new Error(`Invalid phase number: ${phase}. Must be integer 0-4.`);
  }
}

function validateDuration(durationMs: number | undefined): void {
  if (durationMs !== undefined && (durationMs < 0 || !Number.isFinite(durationMs))) {
    throw new Error(`Invalid duration_ms: ${durationMs}. Must be a non-negative finite number.`);
  }
}

// ==================
// Event Emission (Server-side) — VALIDATED
// ==================

/**
 * Emit a build event with validation and automatic sequence numbering.
 * Sequence is determined by counting existing events for this build + 1.
 */
export async function emitBuildEvent(params: EmitEventParams): Promise<BuildEvent> {
  // Validate all inputs
  if (!params.build_job_id) throw new Error('build_job_id is required');
  validateEventType(params.event_type);
  validatePhase(params.phase);
  validateDuration(params.duration_ms);

  // Get next sequence number atomically
  const { count, error: countError } = await supabase
    .from('build_events')
    .select('*', { count: 'exact', head: true })
    .eq('build_job_id', params.build_job_id);

  if (countError) throw new Error(`Failed to get event count: ${countError.message}`);
  const nextSequence = (count || 0) + 1;

  const { data, error } = await supabase
    .from('build_events')
    .insert({
      build_job_id: params.build_job_id,
      sequence: nextSequence,
      event_type: params.event_type,
      phase: params.phase ?? null,
      phase_name: params.phase_name ?? null,
      message: params.message ?? null,
      data: params.data ?? null,
      screenshot_url: params.screenshot_url ?? null,
      duration_ms: params.duration_ms ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to emit build event: ${error.message}`);
  return data as BuildEvent;
}

/**
 * Convenience emitters with pre-validated types.
 */
export async function emitPhaseStart(buildJobId: string, phase: number, phaseName: string) {
  validatePhase(phase);
  return emitBuildEvent({
    build_job_id: buildJobId,
    event_type: 'phase_start',
    phase,
    phase_name: phaseName,
    message: `Starting ${phaseName}...`,
  });
}

export async function emitPhaseComplete(
  buildJobId: string,
  phase: number,
  phaseName: string,
  durationMs: number,
  details?: Record<string, unknown>
) {
  validatePhase(phase);
  validateDuration(durationMs);
  return emitBuildEvent({
    build_job_id: buildJobId,
    event_type: 'phase_complete',
    phase,
    phase_name: phaseName,
    message: `${phaseName} — passed`,
    duration_ms: durationMs,
    data: details,
  });
}

export async function emitTestResult(
  buildJobId: string,
  phase: number,
  testName: string,
  passed: boolean,
  details?: Record<string, unknown>
) {
  validatePhase(phase);
  return emitBuildEvent({
    build_job_id: buildJobId,
    event_type: passed ? 'test_pass' : 'test_fail',
    phase,
    message: `${passed ? 'PASS' : 'FAIL'} ${testName}`,
    data: details,
  });
}

export async function emitScreenshot(
  buildJobId: string,
  phase: number,
  screenshotUrl: string,
  description?: string
) {
  validatePhase(phase);
  if (!screenshotUrl) throw new Error('screenshotUrl is required for screenshot events');
  return emitBuildEvent({
    build_job_id: buildJobId,
    event_type: 'screenshot_captured',
    phase,
    message: description || 'Screenshot captured',
    screenshot_url: screenshotUrl,
  });
}

// ==================
// Event Retrieval — ORDERED BY SEQUENCE
// ==================

/**
 * Get all events for a build, ordered by sequence number (deterministic).
 */
export async function getBuildEvents(buildJobId: string): Promise<BuildEvent[]> {
  const { data, error } = await supabase
    .from('build_events')
    .select('*')
    .eq('build_job_id', buildJobId)
    .order('sequence', { ascending: true });

  if (error) throw new Error(`Failed to fetch build events: ${error.message}`);
  return (data || []) as BuildEvent[];
}

/**
 * Get events after a specific sequence number (for reconnection backfill).
 * Client stores lastSeenSequence and requests only missing events.
 */
export async function getEventsSince(
  buildJobId: string,
  afterSequence: number
): Promise<BuildEvent[]> {
  const { data, error } = await supabase
    .from('build_events')
    .select('*')
    .eq('build_job_id', buildJobId)
    .gt('sequence', afterSequence)
    .order('sequence', { ascending: true });

  if (error) throw new Error(`Failed to fetch events since seq ${afterSequence}: ${error.message}`);
  return (data || []) as BuildEvent[];
}

/**
 * Get events filtered by type, ordered by sequence.
 */
export async function getBuildEventsByType(
  buildJobId: string,
  eventTypes: BuildEventType[]
): Promise<BuildEvent[]> {
  // Validate all requested types
  for (const t of eventTypes) validateEventType(t);

  const { data, error } = await supabase
    .from('build_events')
    .select('*')
    .eq('build_job_id', buildJobId)
    .in('event_type', eventTypes)
    .order('sequence', { ascending: true });

  if (error) throw new Error(`Failed to fetch build events: ${error.message}`);
  return (data || []) as BuildEvent[];
}

// ==================
// Real-Time Subscription with Reconnection Backfill
// ==================

export type BuildEventCallback = (event: BuildEvent) => void;

/**
 * Subscribe to real-time build events with reconnection support.
 *
 * DETERMINISTIC ORDERING: Events are buffered and delivered in sequence order.
 * On reconnection, missed events are backfilled from the last-seen sequence
 * before new events are delivered — guarantees no gaps.
 *
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToBuildEvents(
  buildJobId: string,
  onEvent: BuildEventCallback
): () => void {
  let lastSeenSequence = 0;
  let channel: RealtimeChannel;
  const eventBuffer: BuildEvent[] = [];
  let isBackfilling = false;

  async function backfillMissedEvents() {
    if (isBackfilling) return;
    isBackfilling = true;

    try {
      const missed = await getEventsSince(buildJobId, lastSeenSequence);
      for (const event of missed) {
        if (event.sequence > lastSeenSequence) {
          lastSeenSequence = event.sequence;
          onEvent(event);
        }
      }
    } catch (err) {
      console.error('Failed to backfill events:', err);
    } finally {
      isBackfilling = false;

      // Process any buffered events that arrived during backfill
      while (eventBuffer.length > 0) {
        const buffered = eventBuffer.shift()!;
        if (buffered.sequence > lastSeenSequence) {
          lastSeenSequence = buffered.sequence;
          onEvent(buffered);
        }
      }
    }
  }

  channel = supabase
    .channel(`build-events-${buildJobId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'build_events',
        filter: `build_job_id=eq.${buildJobId}`,
      },
      (payload) => {
        const newEvent = payload.new as BuildEvent;

        if (isBackfilling) {
          // Buffer events during backfill to prevent out-of-order delivery
          eventBuffer.push(newEvent);
          return;
        }

        // Check for gaps — if we missed events, trigger backfill
        if (newEvent.sequence > lastSeenSequence + 1) {
          eventBuffer.push(newEvent);
          backfillMissedEvents();
          return;
        }

        // Normal delivery — in sequence
        if (newEvent.sequence > lastSeenSequence) {
          lastSeenSequence = newEvent.sequence;
          onEvent(newEvent);
        }
      }
    )
    .subscribe((status) => {
      // On reconnection, backfill any missed events
      if (status === 'SUBSCRIBED' && lastSeenSequence > 0) {
        backfillMissedEvents();
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to build job status changes.
 * Fires when the build_jobs row is updated (status change, phase change, etc.)
 */
export function subscribeToBuildStatus(
  buildJobId: string,
  onUpdate: (build: Record<string, unknown>) => void
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`build-status-${buildJobId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'build_jobs',
        filter: `id=eq.${buildJobId}`,
      },
      (payload) => {
        onUpdate(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
