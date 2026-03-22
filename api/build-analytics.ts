/**
 * Build Analytics API — Internal metrics for admin dashboard
 *
 * GET /api/build-analytics?type=summary — Aggregated summary
 * GET /api/build-analytics?type=timeseries — Daily time series data
 * GET /api/build-analytics?type=avg-delivery — Average time to delivery
 * POST /api/build-analytics — Record analytics for a build (system only)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid authentication' });
  }

  // Admin check for all analytics endpoints
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (role?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // GET — Fetch analytics
    if (req.method === 'GET') {
      const { type = 'summary', days = '30' } = req.query || {};
      const daysBack = parseInt(days);
      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      if (type === 'summary') {
        const { data, error } = await supabase
          .from('build_analytics')
          .select('*')
          .gte('created_at', since);

        if (error) throw error;
        const records = data || [];

        if (records.length === 0) {
          return res.status(200).json({
            summary: {
              total_builds: 0, successful_builds: 0, failed_builds: 0,
              success_rate: 0, avg_build_time_ms: 0, avg_visual_score: 0,
              retry_rate: 0, first_attempt_success_rate: 0, avg_tests_passed_pct: 0,
              builds_by_complexity: {}, failure_distribution: {},
              avg_phase_times: { phase_1: 0, phase_2: 0, phase_3: 0, phase_4: 0 },
            },
          });
        }

        const successful = records.filter((r: any) => r.failure_phase === null);
        const failed = records.filter((r: any) => r.failure_phase !== null);
        const withRetries = records.filter((r: any) => r.retry_count > 0);
        const firstAttempt = records.filter((r: any) => r.retry_count === 0 && r.failure_phase === null);

        const avg = (arr: number[]) => arr.length > 0
          ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
          : 0;

        const durations = records.filter((r: any) => r.total_duration_ms).map((r: any) => r.total_duration_ms);
        const scores = records.filter((r: any) => r.phase_3_visual_score).map((r: any) => r.phase_3_visual_score);
        const testRates = records
          .filter((r: any) => r.phase_2_test_count > 0)
          .map((r: any) => (r.phase_2_tests_passed || 0) / r.phase_2_test_count);

        const byComplexity: Record<string, number> = {};
        const failureDist: Record<string, number> = {};
        for (const r of records) {
          const tier = (r as any).app_complexity_tier || 'unknown';
          byComplexity[tier] = (byComplexity[tier] || 0) + 1;
        }
        for (const r of failed) {
          const phase = `Phase ${(r as any).failure_phase}`;
          failureDist[phase] = (failureDist[phase] || 0) + 1;
        }

        const phaseAvg = (field: string) => avg(
          records.filter((r: any) => r[field]).map((r: any) => r[field])
        );

        return res.status(200).json({
          summary: {
            total_builds: records.length,
            successful_builds: successful.length,
            failed_builds: failed.length,
            success_rate: Math.round((successful.length / records.length) * 100),
            avg_build_time_ms: avg(durations),
            avg_visual_score: avg(scores),
            retry_rate: Math.round((withRetries.length / records.length) * 100),
            first_attempt_success_rate: Math.round((firstAttempt.length / records.length) * 100),
            avg_tests_passed_pct: testRates.length > 0
              ? Math.round((testRates.reduce((a: number, b: number) => a + b, 0) / testRates.length) * 100)
              : 0,
            builds_by_complexity: byComplexity,
            failure_distribution: failureDist,
            avg_phase_times: {
              phase_1: phaseAvg('phase_1_duration_ms'),
              phase_2: phaseAvg('phase_2_duration_ms'),
              phase_3: phaseAvg('phase_3_duration_ms'),
              phase_4: phaseAvg('phase_4_duration_ms'),
            },
          },
        });
      }

      if (type === 'timeseries') {
        const { data, error } = await supabase
          .from('build_analytics')
          .select('*')
          .gte('created_at', since)
          .order('created_at', { ascending: true });

        if (error) throw error;

        // Group by date
        const byDate = new Map<string, any[]>();
        for (const r of (data || [])) {
          const date = r.created_at.split('T')[0];
          if (!byDate.has(date)) byDate.set(date, []);
          byDate.get(date)!.push(r);
        }

        // Fill all dates
        const points = [];
        const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
        for (let d = 0; d < daysBack; d++) {
          const date = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
          const dateStr = date.toISOString().split('T')[0];
          const dayRecords = byDate.get(dateStr) || [];

          const successful = dayRecords.filter(r => r.failure_phase === null);
          const durations = dayRecords.filter(r => r.total_duration_ms).map(r => r.total_duration_ms);

          points.push({
            date: dateStr,
            total: dayRecords.length,
            successful: successful.length,
            failed: dayRecords.length - successful.length,
            avg_duration_ms: durations.length > 0
              ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
              : 0,
          });
        }

        return res.status(200).json({ timeseries: points });
      }

      if (type === 'avg-delivery') {
        const { data } = await supabase
          .from('build_analytics')
          .select('total_duration_ms')
          .gte('created_at', since)
          .not('total_duration_ms', 'is', null);

        if (!data || data.length === 0) {
          return res.status(200).json({ avg_delivery_ms: 0, count: 0 });
        }

        const total = data.reduce((sum, r) => sum + (r.total_duration_ms || 0), 0);
        return res.status(200).json({
          avg_delivery_ms: Math.round(total / data.length),
          count: data.length,
        });
      }

      return res.status(400).json({ error: 'Invalid type. Use: summary, timeseries, avg-delivery' });
    }

    // POST — Record analytics (system only, validated)
    if (req.method === 'POST') {
      const body = req.body;

      // Validate required field
      if (!body.build_job_id) {
        return res.status(400).json({ error: 'build_job_id is required' });
      }

      // Validate numeric ranges — no negative durations
      const durationFields = ['total_duration_ms', 'phase_1_duration_ms', 'phase_2_duration_ms',
        'phase_3_duration_ms', 'phase_4_duration_ms', 'queue_wait_ms', 'deployment_duration_ms'];
      for (const field of durationFields) {
        if (body[field] !== undefined && (typeof body[field] !== 'number' || body[field] < 0)) {
          return res.status(400).json({ error: `${field} must be a non-negative number` });
        }
      }

      // Validate test counts — passed cannot exceed total
      if (body.phase_2_tests_passed !== undefined && body.phase_2_test_count !== undefined) {
        if (body.phase_2_tests_passed > body.phase_2_test_count) {
          return res.status(400).json({
            error: `phase_2_tests_passed (${body.phase_2_tests_passed}) cannot exceed phase_2_test_count (${body.phase_2_test_count})`
          });
        }
      }
      if (body.phase_3_interactions_passed !== undefined && body.phase_3_interactions_tested !== undefined) {
        if (body.phase_3_interactions_passed > body.phase_3_interactions_tested) {
          return res.status(400).json({
            error: `phase_3_interactions_passed (${body.phase_3_interactions_passed}) cannot exceed phase_3_interactions_tested (${body.phase_3_interactions_tested})`
          });
        }
      }

      // Validate visual score range
      if (body.phase_3_visual_score !== undefined) {
        if (body.phase_3_visual_score < 0 || body.phase_3_visual_score > 100) {
          return res.status(400).json({ error: 'phase_3_visual_score must be between 0 and 100' });
        }
      }

      const { data, error } = await supabase
        .from('build_analytics')
        .insert(body)
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ analytics: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('Build analytics API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
