/**
 * Build Jobs API — Create and manage builds with idempotency
 *
 * POST /api/build-jobs — Create a new build (idempotent)
 * GET  /api/build-jobs — Get user's builds
 * GET  /api/build-jobs?id=xxx — Get specific build
 * PUT  /api/build-jobs — Update build status (admin/system)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Authenticate user
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid authentication' });
  }

  try {
    // POST — Create build with idempotency
    if (req.method === 'POST') {
      const { idempotency_key, app_name, app_description, spec, priority, complexity_tier } = req.body;

      if (!idempotency_key || !app_name) {
        return res.status(400).json({ error: 'idempotency_key and app_name are required' });
      }

      // Validate enum values deterministically
      const validPriorities = ['low', 'standard', 'high', 'critical'];
      const validComplexity = ['simple', 'standard', 'complex', 'enterprise'];
      if (priority && !validPriorities.includes(priority)) {
        return res.status(400).json({ error: `Invalid priority: ${priority}. Must be one of: ${validPriorities.join(', ')}` });
      }
      if (complexity_tier && !validComplexity.includes(complexity_tier)) {
        return res.status(400).json({ error: `Invalid complexity_tier: ${complexity_tier}. Must be one of: ${validComplexity.join(', ')}` });
      }

      // Check for existing build with same idempotency key
      const { data: existing } = await supabase
        .from('build_jobs')
        .select('*')
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();

      if (existing) {
        return res.status(200).json({ build: existing, created: false });
      }

      // Create new build
      const { data, error } = await supabase
        .from('build_jobs')
        .insert({
          idempotency_key,
          user_id: user.id,
          app_name,
          app_description: app_description || null,
          spec: spec || null,
          status: 'queued',
          current_phase: 0,
          current_phase_name: 'Queued',
          phases_completed: [],
          progress_percentage: 0,
          priority: priority || 'standard',
          complexity_tier: complexity_tier || null,
          retry_count: 0,
          max_retries: 3,
        })
        .select()
        .single();

      if (error) {
        // Race condition — another request created it
        if (error.code === '23505') {
          const { data: raceResult } = await supabase
            .from('build_jobs')
            .select('*')
            .eq('idempotency_key', idempotency_key)
            .single();
          return res.status(200).json({ build: raceResult, created: false });
        }
        throw error;
      }

      return res.status(201).json({ build: data, created: true });
    }

    // GET — Fetch builds
    if (req.method === 'GET') {
      const { id, status, limit = '20', offset = '0' } = req.query || {};

      // Single build
      if (id) {
        const { data, error } = await supabase
          .from('build_jobs')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Build not found' });
        return res.status(200).json({ build: data });
      }

      // List builds
      let query = supabase
        .from('build_jobs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json({ builds: data || [] });
    }

    // PUT — Update build status (admin/system only)
    if (req.method === 'PUT') {
      // Check if user is admin
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (role?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { id, status: newStatus, current_phase, current_phase_name, progress_percentage, error_context } = req.body;

      if (!id || !newStatus) {
        return res.status(400).json({ error: 'id and status are required' });
      }

      // Validate new status is a valid value
      const validStatuses = ['queued', 'building', 'testing', 'deploying', 'complete', 'failed', 'cancelled'];
      if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({ error: `Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}` });
      }

      // Fetch current build to validate transition server-side
      const { data: currentBuild } = await supabase
        .from('build_jobs')
        .select('status, current_phase')
        .eq('id', id)
        .single();

      if (!currentBuild) {
        return res.status(404).json({ error: 'Build not found' });
      }

      // Validate state machine transition
      const validTransitions: Record<string, string[]> = {
        queued: ['building', 'cancelled', 'failed'],
        building: ['testing', 'failed', 'cancelled'],
        testing: ['deploying', 'failed', 'cancelled'],
        deploying: ['complete', 'failed', 'cancelled'],
        complete: [],
        failed: ['building'],
        cancelled: [],
      };

      const allowed = validTransitions[currentBuild.status] || [];
      if (!allowed.includes(newStatus)) {
        return res.status(400).json({
          error: `Illegal status transition: ${currentBuild.status} → ${newStatus}. Allowed: [${allowed.join(', ')}]`
        });
      }

      // Validate phase progression (no regression except on retry)
      if (current_phase !== undefined && current_phase < currentBuild.current_phase) {
        if (!(currentBuild.status === 'failed' && newStatus === 'building')) {
          return res.status(400).json({
            error: `Phase regression not allowed: ${currentBuild.current_phase} → ${current_phase}`
          });
        }
      }

      const updates: Record<string, unknown> = { status: newStatus };
      if (current_phase !== undefined) updates.current_phase = current_phase;
      if (current_phase_name) updates.current_phase_name = current_phase_name;
      if (progress_percentage !== undefined) updates.progress_percentage = progress_percentage;
      if (error_context) updates.error_context = error_context;
      if (newStatus === 'building' && currentBuild.status === 'queued') updates.started_at = new Date().toISOString();
      if (newStatus === 'complete' || newStatus === 'failed' || newStatus === 'cancelled') updates.completed_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('build_jobs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ build: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('Build jobs API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
