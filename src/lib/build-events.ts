/**
 * Build Events — Real-time progress tracking
 *
 * Records and streams build progress events. Powers the real-time
 * build progress UI via Supabase Realtime subscriptions.
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ==================
// Types
// ==================

export type BuildEventType =
  | 'phase_start' | 'phase_complete' | 'phase_failed'
  | 'test_start' | 'test_pass' | 'test_fail'
  | 'screenshot_captured' | 'video_captured'
  | 'build_complete' | 'build_failed'
  | 'retry_start' | 'retry_complete'
  | 'deploy_start' | 'deploy_progress' | 'deploy_complete' | 'deploy_failed'
  | 'info' | 'warning' | 'error';

export interface BuildEvent {
  id: string;
  build_job_id: string;
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
// Event Emission (Server-side)
// ==================

/**
 * Emit a build event. Called by the build pipeline as it progresses.
 * These events are picked up by Supabase Realtime and pushed to connected clients.
 */
export async function emitBuildEvent(params: EmitEventParams): Promise<BuildEvent> {
  const { data, error } = await supabase
    .from('build_events')
    .insert({
      build_job_id: params.build_job_id,
      event_type: params.event_type,
      phase: params.phase || null,
      phase_name: params.phase_name || null,
      message: params.message || null,
      data: params.data || null,
      screenshot_url: params.screenshot_url || null,
      duration_ms: params.duration_ms || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to emit build event: ${error.message}`);
  return data as BuildEvent;
}

/**
 * Emit a sequence of common phase events.
 */
export async function emitPhaseStart(buildJobId: string, phase: number, phaseName: string) {
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
  return emitBuildEvent({
    build_job_id: buildJobId,
    event_type: passed ? 'test_pass' : 'test_fail',
    phase,
    message: `${passed ? '✅' : '❌'} ${testName}`,
    data: details,
  });
}

export async function emitScreenshot(
  buildJobId: string,
  phase: number,
  screenshotUrl: string,
  description?: string
) {
  return emitBuildEvent({
    build_job_id: buildJobId,
    event_type: 'screenshot_captured',
    phase,
    message: description || 'Screenshot captured',
    screenshot_url: screenshotUrl,
  });
}

// ==================
// Event Retrieval
// ==================

/**
 * Get all events for a build job, ordered chronologically.
 */
export async function getBuildEvents(buildJobId: string): Promise<BuildEvent[]> {
  const { data, error } = await supabase
    .from('build_events')
    .select('*')
    .eq('build_job_id', buildJobId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch build events: ${error.message}`);
  return (data || []) as BuildEvent[];
}

/**
 * Get events filtered by type.
 */
export async function getBuildEventsByType(
  buildJobId: string,
  eventTypes: BuildEventType[]
): Promise<BuildEvent[]> {
  const { data, error } = await supabase
    .from('build_events')
    .select('*')
    .eq('build_job_id', buildJobId)
    .in('event_type', eventTypes)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch build events: ${error.message}`);
  return (data || []) as BuildEvent[];
}

// ==================
// Real-Time Subscription (Client-side)
// ==================

export type BuildEventCallback = (event: BuildEvent) => void;

/**
 * Subscribe to real-time build events for a specific build.
 * Uses Supabase Realtime to push events as they're inserted.
 *
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToBuildEvents(
  buildJobId: string,
  onEvent: BuildEventCallback
): () => void {
  const channel: RealtimeChannel = supabase
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
        onEvent(payload.new as BuildEvent);
      }
    )
    .subscribe();

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
