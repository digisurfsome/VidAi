/**
 * Build Events API — Real-time progress event management
 *
 * GET  /api/build-events?build_id=xxx — Get events for a build
 * POST /api/build-events — Emit a new event (system/admin only)
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

  try {
    // GET — Fetch events for a build
    if (req.method === 'GET') {
      const { build_id, event_type, limit = '100' } = req.query || {};

      if (!build_id) {
        return res.status(400).json({ error: 'build_id is required' });
      }

      // Verify user owns this build
      const { data: build } = await supabase
        .from('build_jobs')
        .select('id')
        .eq('id', build_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!build) {
        return res.status(404).json({ error: 'Build not found' });
      }

      let query = supabase
        .from('build_events')
        .select('*')
        .eq('build_job_id', build_id)
        .order('created_at', { ascending: true })
        .limit(parseInt(limit));

      if (event_type) {
        query = query.eq('event_type', event_type);
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json({ events: data || [] });
    }

    // POST — Emit event (admin/system only)
    if (req.method === 'POST') {
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (role?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { build_job_id, event_type, phase, phase_name, message, data: eventData, screenshot_url, duration_ms } = req.body;

      if (!build_job_id || !event_type) {
        return res.status(400).json({ error: 'build_job_id and event_type are required' });
      }

      const { data, error } = await supabase
        .from('build_events')
        .insert({
          build_job_id,
          event_type,
          phase: phase || null,
          phase_name: phase_name || null,
          message: message || null,
          data: eventData || null,
          screenshot_url: screenshot_url || null,
          duration_ms: duration_ms || null,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ event: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('Build events API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
