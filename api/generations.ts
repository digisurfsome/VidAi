import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const { rateLimiters, applyRateLimit } = require('./lib/rate-limiter.js');

// Enable CORS for local development
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Initialize Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get auth token from headers
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    // Create authenticated Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Apply rate limiting
    const rateLimitResult = applyRateLimit(rateLimiters.history, user.id, res);
    if (!rateLimitResult.allowed) {
      return res.status(429).json(rateLimitResult.error);
    }

    // Parse query parameters
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status'); // optional filter by status
    const model = url.searchParams.get('model'); // optional filter by model

    // Validate parameters
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    if (offset < 0) {
      return res.status(400).json({ error: 'Offset must be non-negative' });
    }

    // Build query
    let query = supabase
      .from('video_generations')
      .select(`
        id,
        prompt,
        negative_prompt,
        model_id,
        parameters,
        video_url,
        thumbnail_url,
        status,
        duration_seconds,
        width,
        height,
        generation_time_ms,
        error_message,
        created_at,
        updated_at
      `, { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply optional filters
    if (status) {
      const validStatuses = ['pending', 'processing', 'completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      query = query.eq('status', status);
    }

    if (model) {
      query = query.eq('model_id', model);
    }

    // Execute query
    const { data: generations, error: fetchError, count } = await query;

    if (fetchError) {
      console.error('Database error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch generations' });
    }

    // Calculate pagination info
    const totalPages = Math.ceil((count || 0) / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const hasMore = offset + limit < (count || 0);

    // Format response
    const formattedGenerations = (generations || []).map(gen => ({
      id: gen.id,
      prompt: gen.prompt,
      negativePrompt: gen.negative_prompt,
      model: gen.model_id,
      parameters: gen.parameters,
      videoUrl: gen.video_url,
      thumbnailUrl: gen.thumbnail_url,
      status: gen.status,
      duration: gen.duration_seconds,
      dimensions: gen.width && gen.height ? {
        width: gen.width,
        height: gen.height
      } : null,
      generationTime: gen.generation_time_ms,
      error: gen.error_message,
      createdAt: gen.created_at,
      updatedAt: gen.updated_at
    }));

    // Return generations with pagination info
    return res.status(200).json({
      generations: formattedGenerations,
      pagination: {
        total: count || 0,
        limit,
        offset,
        currentPage,
        totalPages,
        hasMore
      }
    });

  } catch (error: any) {
    console.error('Get generations error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
}