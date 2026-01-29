import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  dotenv.config({ path: join(__dirname, '..', '.env.local') });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    // Get generation ID from URL path
    const generationId = req.url?.split('/').pop();
    if (!generationId) {
      return res.status(400).json({ error: 'Generation ID required' });
    }

    // Get generation status
    const { data: generation, error } = await supabase
      .from('video_generations')
      .select('*')
      .eq('id', generationId)
      .eq('user_id', user.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Generation not found' });
    }

    return res.json({
      id: generation.id,
      status: generation.status,
      video_url: generation.video_url,
      thumbnail_url: generation.thumbnail_url,
      error_message: generation.error_message,
      created_at: generation.created_at,
      updated_at: generation.updated_at,
      duration_seconds: generation.duration_seconds,
      width: generation.width,
      height: generation.height
    });

  } catch (error: any) {
    console.error('Generation status API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
