/**
 * Deployment API — One-click deploy to Vercel
 *
 * POST /api/deploy — Initiate deployment for a completed build
 * GET  /api/deploy?id=xxx — Check deployment status
 * GET  /api/deploy?build_id=xxx — Get deployment by build
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
    // POST — Initiate deployment
    if (req.method === 'POST') {
      const { build_job_id, provider, framework_preset, build_command, output_directory } = req.body;

      if (!build_job_id) {
        return res.status(400).json({ error: 'build_job_id is required' });
      }

      // Verify the build belongs to the user and is complete
      const { data: build } = await supabase
        .from('build_jobs')
        .select('*')
        .eq('id', build_job_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!build) {
        return res.status(404).json({ error: 'Build not found' });
      }

      if (build.status !== 'complete' && build.status !== 'deploying') {
        return res.status(400).json({ error: 'Build must be complete before deployment' });
      }

      // Check for existing deployment
      const { data: existingDeploy } = await supabase
        .from('app_deployments')
        .select('*')
        .eq('build_job_id', build_job_id)
        .in('status', ['pending', 'creating_repo', 'pushing_code', 'deploying', 'live'])
        .maybeSingle();

      if (existingDeploy) {
        return res.status(200).json({
          deployment: existingDeploy,
          created: false,
          message: 'Deployment already exists for this build',
        });
      }

      // Create deployment record
      const { data, error } = await supabase
        .from('app_deployments')
        .insert({
          build_job_id,
          user_id: user.id,
          provider: provider || 'vercel',
          status: 'pending',
          framework_preset: framework_preset || 'vite',
          build_command: build_command || 'npm run build',
          output_directory: output_directory || 'dist',
        })
        .select()
        .single();

      if (error) throw error;

      // Update build status to deploying
      await supabase
        .from('build_jobs')
        .update({
          status: 'deploying',
          current_phase: 4,
          current_phase_name: 'Deployment',
        })
        .eq('id', build_job_id);

      // Emit deployment start event
      await supabase
        .from('build_events')
        .insert({
          build_job_id,
          event_type: 'deploy_start',
          phase: 4,
          phase_name: 'Deployment',
          message: `Initiating ${provider || 'Vercel'} deployment...`,
        });

      return res.status(201).json({ deployment: data, created: true });
    }

    // GET — Check deployment status
    if (req.method === 'GET') {
      const { id, build_id } = req.query || {};

      if (id) {
        const { data, error } = await supabase
          .from('app_deployments')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Deployment not found' });
        return res.status(200).json({ deployment: data });
      }

      if (build_id) {
        const { data, error } = await supabase
          .from('app_deployments')
          .select('*')
          .eq('build_job_id', build_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'No deployment found for this build' });
        return res.status(200).json({ deployment: data });
      }

      // List all user deployments
      const { data, error } = await supabase
        .from('app_deployments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return res.status(200).json({ deployments: data || [] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('Deploy API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
