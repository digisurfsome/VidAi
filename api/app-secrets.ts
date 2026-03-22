/**
 * App Secrets API — Per-app secret vault management
 *
 * GET    /api/app-secrets?app_id=xxx — List secrets (metadata only)
 * POST   /api/app-secrets — Set/update a secret
 * DELETE /api/app-secrets — Delete a secret
 * POST   /api/app-secrets?action=generate-env — Generate .env.local content (system only)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    // GET — List secrets for an app (metadata only, no values)
    if (req.method === 'GET') {
      const { app_id } = req.query || {};

      if (!app_id) {
        return res.status(400).json({ error: 'app_id is required' });
      }

      const { data, error } = await supabase
        .from('app_secrets')
        .select('id, app_id, user_id, key_name, key_type, description, is_required, last_rotated_at, created_at, updated_at')
        .eq('app_id', app_id)
        .eq('user_id', user.id)
        .order('key_name');

      if (error) throw error;
      return res.status(200).json({ secrets: data || [] });
    }

    // POST — Set/update a secret or generate env file
    if (req.method === 'POST') {
      const { action } = req.query || {};

      // Generate .env.local content (admin/system only — returns decrypted values)
      if (action === 'generate-env') {
        const { data: role } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (role?.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required for env generation' });
        }

        const { app_id } = req.body;
        if (!app_id) {
          return res.status(400).json({ error: 'app_id is required' });
        }

        // Fetch all secrets with encrypted values
        const { data, error } = await supabase
          .from('app_secrets')
          .select('key_name, encrypted_value, iv, tag')
          .eq('app_id', app_id);

        if (error) throw error;

        // Note: Actual decryption happens server-side with the encryption key
        // For now, return the raw data for the build system to decrypt
        return res.status(200).json({
          app_id,
          secrets: data || [],
          count: data?.length || 0,
        });
      }

      // Set/update a secret
      const { app_id, key_name, encrypted_value, iv, tag, key_type, description, is_required } = req.body;

      if (!app_id || !key_name || !encrypted_value || !iv || !tag) {
        return res.status(400).json({ error: 'app_id, key_name, encrypted_value, iv, and tag are required' });
      }

      const { data, error } = await supabase
        .from('app_secrets')
        .upsert(
          {
            app_id,
            user_id: user.id,
            key_name,
            encrypted_value,
            iv,
            tag,
            key_type: key_type || 'env',
            description: description || null,
            is_required: is_required ?? false,
            last_rotated_at: new Date().toISOString(),
          },
          { onConflict: 'app_id,key_name' }
        )
        .select('id, app_id, user_id, key_name, key_type, description, is_required, last_rotated_at, created_at, updated_at')
        .single();

      if (error) throw error;
      return res.status(200).json({ secret: data });
    }

    // DELETE — Remove a secret
    if (req.method === 'DELETE') {
      const { app_id, key_name } = req.body || req.query || {};

      if (!app_id || !key_name) {
        return res.status(400).json({ error: 'app_id and key_name are required' });
      }

      const { error } = await supabase
        .from('app_secrets')
        .delete()
        .eq('app_id', app_id)
        .eq('user_id', user.id)
        .eq('key_name', key_name);

      if (error) throw error;
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('App secrets API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
