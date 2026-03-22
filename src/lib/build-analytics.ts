/**
 * Build Analytics — Internal metrics and data collection
 *
 * Captures detailed metrics from every build for the internal analytics dashboard.
 * Tracks success rates, timing, failure patterns, and quality scores.
 * Powers data-driven improvement of the builder itself.
 */

import { supabase } from './supabase';

// ==================
// Types
// ==================

export interface BuildAnalytics {
  id: string;
  build_job_id: string;

  // Timing
  total_duration_ms: number | null;
  phase_1_duration_ms: number | null;
  phase_2_duration_ms: number | null;
  phase_3_duration_ms: number | null;
  phase_4_duration_ms: number | null;
  queue_wait_ms: number | null;

  // Phase 1 details
  phase_1_passed: boolean | null;
  npm_install_ms: number | null;
  typecheck_ms: number | null;
  lint_ms: number | null;
  build_ms: number | null;

  // Phase 2 details
  phase_2_test_count: number | null;
  phase_2_tests_passed: number | null;
  phase_2_console_errors: number;
  phase_2_uncaught_exceptions: number;

  // Phase 3 details
  phase_3_visual_score: number | null;
  phase_3_interactions_tested: number | null;
  phase_3_interactions_passed: number | null;
  phase_3_pages_tested: number | null;

  // Build metadata
  retry_count: number;
  final_attempt: number;
  failure_phase: number | null;
  failure_reason: string | null;
  app_complexity_tier: string | null;
  routes_count: number | null;
  components_count: number | null;
  total_lines_of_code: number | null;

  // Deployment
  deployment_duration_ms: number | null;
  deployment_succeeded: boolean | null;

  created_at: string;
}

export interface RecordAnalyticsParams {
  build_job_id: string;
  total_duration_ms?: number;
  phase_1_duration_ms?: number;
  phase_2_duration_ms?: number;
  phase_3_duration_ms?: number;
  phase_4_duration_ms?: number;
  queue_wait_ms?: number;
  phase_1_passed?: boolean;
  npm_install_ms?: number;
  typecheck_ms?: number;
  lint_ms?: number;
  build_ms?: number;
  phase_2_test_count?: number;
  phase_2_tests_passed?: number;
  phase_2_console_errors?: number;
  phase_2_uncaught_exceptions?: number;
  phase_3_visual_score?: number;
  phase_3_interactions_tested?: number;
  phase_3_interactions_passed?: number;
  phase_3_pages_tested?: number;
  retry_count?: number;
  final_attempt?: number;
  failure_phase?: number;
  failure_reason?: string;
  app_complexity_tier?: string;
  routes_count?: number;
  components_count?: number;
  total_lines_of_code?: number;
  deployment_duration_ms?: number;
  deployment_succeeded?: boolean;
}

export interface AnalyticsSummary {
  total_builds: number;
  successful_builds: number;
  failed_builds: number;
  success_rate: number;
  avg_build_time_ms: number;
  avg_visual_score: number;
  retry_rate: number;
  first_attempt_success_rate: number;
  avg_tests_passed_pct: number;
  builds_by_complexity: Record<string, number>;
  failure_distribution: Record<string, number>;
  avg_phase_times: {
    phase_1: number;
    phase_2: number;
    phase_3: number;
    phase_4: number;
  };
}

export interface TimeSeriesPoint {
  date: string;
  total: number;
  successful: number;
  failed: number;
  avg_duration_ms: number;
  avg_visual_score: number;
}

// ==================
// Record Analytics
// ==================

/**
 * Record analytics for a completed build.
 * Called by the build pipeline after all phases finish (pass or fail).
 */
export async function recordBuildAnalytics(params: RecordAnalyticsParams): Promise<BuildAnalytics> {
  const { data, error } = await supabase
    .from('build_analytics')
    .insert(params)
    .select()
    .single();

  if (error) throw new Error(`Failed to record analytics: ${error.message}`);
  return data as BuildAnalytics;
}

// ==================
// Analytics Queries (Admin Dashboard)
// ==================

/**
 * Get summary analytics for the admin dashboard.
 * Aggregates across all builds within the given date range.
 */
export async function getAnalyticsSummary(
  daysBack = 30
): Promise<AnalyticsSummary> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('build_analytics')
    .select('*')
    .gte('created_at', since);

  if (error) throw new Error(`Failed to fetch analytics: ${error.message}`);

  const records = (data || []) as BuildAnalytics[];
  if (records.length === 0) {
    return {
      total_builds: 0,
      successful_builds: 0,
      failed_builds: 0,
      success_rate: 0,
      avg_build_time_ms: 0,
      avg_visual_score: 0,
      retry_rate: 0,
      first_attempt_success_rate: 0,
      avg_tests_passed_pct: 0,
      builds_by_complexity: {},
      failure_distribution: {},
      avg_phase_times: { phase_1: 0, phase_2: 0, phase_3: 0, phase_4: 0 },
    };
  }

  const successful = records.filter(r => r.failure_phase === null);
  const failed = records.filter(r => r.failure_phase !== null);
  const withRetries = records.filter(r => r.retry_count > 0);
  const firstAttemptSuccess = records.filter(r => r.retry_count === 0 && r.failure_phase === null);

  // Avg build time
  const durations = records.filter(r => r.total_duration_ms).map(r => r.total_duration_ms!);
  const avgBuildTime = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Avg visual score
  const scores = records.filter(r => r.phase_3_visual_score).map(r => r.phase_3_visual_score!);
  const avgVisualScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  // Avg test pass rate
  const testRates = records
    .filter(r => r.phase_2_test_count && r.phase_2_test_count > 0)
    .map(r => (r.phase_2_tests_passed || 0) / r.phase_2_test_count!);
  const avgTestsPassed = testRates.length > 0
    ? Math.round((testRates.reduce((a, b) => a + b, 0) / testRates.length) * 100)
    : 0;

  // Complexity breakdown
  const byComplexity: Record<string, number> = {};
  for (const r of records) {
    const tier = r.app_complexity_tier || 'unknown';
    byComplexity[tier] = (byComplexity[tier] || 0) + 1;
  }

  // Failure distribution by phase
  const failureDist: Record<string, number> = {};
  for (const r of failed) {
    const phase = `Phase ${r.failure_phase}`;
    failureDist[phase] = (failureDist[phase] || 0) + 1;
  }

  // Average phase times
  const avgPhase = (field: keyof BuildAnalytics) => {
    const vals = records.filter(r => r[field]).map(r => r[field] as number);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  return {
    total_builds: records.length,
    successful_builds: successful.length,
    failed_builds: failed.length,
    success_rate: Math.round((successful.length / records.length) * 100),
    avg_build_time_ms: avgBuildTime,
    avg_visual_score: avgVisualScore,
    retry_rate: Math.round((withRetries.length / records.length) * 100),
    first_attempt_success_rate: Math.round((firstAttemptSuccess.length / records.length) * 100),
    avg_tests_passed_pct: avgTestsPassed,
    builds_by_complexity: byComplexity,
    failure_distribution: failureDist,
    avg_phase_times: {
      phase_1: avgPhase('phase_1_duration_ms'),
      phase_2: avgPhase('phase_2_duration_ms'),
      phase_3: avgPhase('phase_3_duration_ms'),
      phase_4: avgPhase('phase_4_duration_ms'),
    },
  };
}

/**
 * Get time-series analytics data for charting.
 * Returns daily aggregates for the given period.
 */
export async function getAnalyticsTimeSeries(daysBack = 30): Promise<TimeSeriesPoint[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('build_analytics')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch analytics: ${error.message}`);

  const records = (data || []) as BuildAnalytics[];

  // Group by date
  const byDate = new Map<string, BuildAnalytics[]>();
  for (const r of records) {
    const date = r.created_at.split('T')[0];
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(r);
  }

  // Fill in missing dates
  const points: TimeSeriesPoint[] = [];
  const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  for (let d = 0; d < daysBack; d++) {
    const date = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const dayRecords = byDate.get(dateStr) || [];

    const successful = dayRecords.filter(r => r.failure_phase === null);
    const failed = dayRecords.filter(r => r.failure_phase !== null);

    const durations = dayRecords.filter(r => r.total_duration_ms).map(r => r.total_duration_ms!);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const scores = dayRecords.filter(r => r.phase_3_visual_score).map(r => r.phase_3_visual_score!);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    points.push({
      date: dateStr,
      total: dayRecords.length,
      successful: successful.length,
      failed: failed.length,
      avg_duration_ms: avgDuration,
      avg_visual_score: avgScore,
    });
  }

  return points;
}

/**
 * Get the single most important number: time from prompt to delivery.
 */
export async function getAverageTimeToDelivery(daysBack = 30): Promise<number> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('build_analytics')
    .select('total_duration_ms')
    .gte('created_at', since)
    .not('total_duration_ms', 'is', null);

  if (!data || data.length === 0) return 0;

  const total = data.reduce((sum, r) => sum + (r.total_duration_ms || 0), 0);
  return Math.round(total / data.length);
}
