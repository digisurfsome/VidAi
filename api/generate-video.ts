import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { fal } from '@fal-ai/client';
import { getApiKeys, logApiKeyUsage } from '../src/lib/api-keys';

import { rateLimiters, applyRateLimit } from './lib/rate-limiter.js';

// Enable CORS for local development
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Initialize Supabase clients
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
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
    const rateLimitResult = applyRateLimit(rateLimiters.generation, user.id, res);
    if (!rateLimitResult.allowed) {
      return res.status(429).json(rateLimitResult.error);
    }

    // Validate request body
    const { prompt, model, aspectRatio, negativePrompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.length < 10 || prompt.length > 500) {
      return res.status(400).json({ error: 'Invalid prompt. Must be 10-500 characters.' });
    }

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Model is required' });
    }

    const validAspectRatios = ['16:9', '9:16', '1:1'];
    if (!aspectRatio || !validAspectRatios.includes(aspectRatio)) {
      return res.status(400).json({ error: 'Invalid aspect ratio' });
    }

    // Get API keys with fallback logic (user keys > admin keys > none)
    console.log('Getting API keys for user:', user.id);
    const apiKeys = await getApiKeys(user.id, supabaseUrl, supabaseServiceKey);
    console.log('API keys result:', { 
      hasFal: !!apiKeys.fal, 
      falSource: apiKeys.fal?.source,
      hasOpenAI: !!apiKeys.openai,
      openAISource: apiKeys.openai?.source 
    });
    
    if (!apiKeys.fal) {
      return res.status(400).json({ 
        error: 'fal.ai API key not configured. Please add your API key in Settings or contact your administrator.' 
      });
    }

    // Configure fal client with the resolved API key
    fal.config({
      credentials: apiKeys.fal.key
    });

    // Create service role client for database operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Check user credits before proceeding
    const { data: creditData, error: creditError } = await serviceClient
      .from('user_credits')
      .select('balance')
      .eq('user_id', user.id)
      .single();
    
    if (creditError || !creditData) {
      // If no credit record exists, create one with 0 balance
      if (creditError?.code === 'PGRST116') {
        await serviceClient
          .from('user_credits')
          .insert({ user_id: user.id, balance: 0 });
        return res.status(402).json({ 
          error: 'Insufficient credits. You need at least 1 credit to generate a video.' 
        });
      }
      return res.status(500).json({ error: 'Failed to check credit balance' });
    }
    
    // Check if user has sufficient credits (1 credit required)
    if (creditData.balance < 1) {
      return res.status(402).json({ 
        error: 'Insufficient credits. You need at least 1 credit to generate a video.' 
      });
    }
    
    // Log API key usage for audit purposes (only logs admin key usage)
    await logApiKeyUsage(user.id, 'fal', apiKeys.fal.source, serviceClient);

    // Create generation record in database using service role client
    const { data: generation, error: dbError } = await serviceClient
      .from('video_generations')
      .insert({
        user_id: user.id,
        prompt,
        model: model,
        metadata: { 
          aspect_ratio: aspectRatio,
          negative_prompt: negativePrompt 
        },
        status: 'processing'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Failed to create generation record' });
    }

    // Start async generation process
    // We'll return immediately and let the client poll for status
    generateVideoAsync(
      user.id,
      generation.id,
      model,
      prompt,
      aspectRatio,
      negativePrompt,
      apiKeys.fal.key,
      apiKeys.fal.source,
      supabaseUrl,
      supabaseServiceKey
    ).catch(error => {
      console.error('Async generation error:', error);
      // Update generation status to failed
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      serviceClient
        .from('video_generations')
        .update({
          status: 'failed',
          error_message: error.message || 'Generation failed'
        })
        .eq('id', generation.id)
        .then(() => {
          console.log('Updated generation status to failed');
        });
    });

    // Return generation ID for status polling
    return res.status(201).json({
      generationId: generation.id,
      status: 'processing',
      message: 'Video generation started. Poll the status endpoint for updates.'
    });

  } catch (error: any) {
    console.error('Generate video error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
}

/**
 * Async function to generate video with fal.ai
 */
async function generateVideoAsync(
  userId: string,
  generationId: string,
  model: string,
  prompt: string,
  aspectRatio: string,
  negativePrompt: string | undefined,
  falApiKey: string,
  keySource: 'user' | 'admin',
  supabaseUrl: string,
  supabaseServiceKey: string
) {
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get the generation record to access metadata
    const { data: generation } = await serviceClient
      .from('video_generations')
      .select('metadata')
      .eq('id', generationId)
      .single();
    
    const metadata = generation?.metadata || {};

    // Configure fal client with the API key
    fal.config({
      credentials: falApiKey
    });

    // Log API key usage for audit purposes (only logs admin key usage)
    await logApiKeyUsage(userId, 'fal', keySource, serviceClient);

    // Prepare model-specific parameters
    let requestPayload: any = { prompt };

    // Model-specific parameter handling
    if (model.includes('veo3')) {
      // Veo 3 / Veo 3.1 models use aspect_ratio as string
      requestPayload = {
        prompt,
        aspect_ratio: aspectRatio, // "16:9", "9:16", or "1:1"
        duration: '8s',
        resolution: '720p',
        generate_audio: true
      };
    } else if (model.includes('hailuo') || model.includes('minimax/hailuo')) {
      // Hailuo-02 models - no aspect ratio control, just prompt optimization
      requestPayload = {
        prompt,
        prompt_optimizer: true
      };
    } else if (model.includes('minimax-video/image-to-video')) {
      // MiniMax Image-to-Video - aspect ratio comes from input image
      requestPayload = {
        prompt,
        prompt_optimizer: true
      };
    } else if (model === 'fal-ai/wan-t2v') {
      // WAN T2V uses aspect_ratio as string
      requestPayload = {
        prompt,
        aspect_ratio: aspectRatio,
        negative_prompt: negativePrompt || '',
        num_inference_steps: 30
      };
    } else {
      // Default fallback - try aspect_ratio as string
      requestPayload = {
        prompt,
        aspect_ratio: aspectRatio
      };
    }

    // Submit to fal.ai
    const result = await fal.subscribe(model, {
      input: requestPayload,
      logs: true,
      onQueueUpdate: (update) => {
        console.log('Queue update:', update);
        // Could update database with queue position here
      }
    });

    // Extract video URL from result
    let videoUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;

    // Handle different response formats
    if (result.data) {
      videoUrl = result.data.video?.url || result.data.video_url || result.data.url;
      thumbnailUrl = result.data.thumbnail?.url || result.data.thumbnail_url;
      duration = result.data.duration || result.data.video?.duration;
      width = result.data.width || result.data.video?.width || dimensions.width;
      height = result.data.height || result.data.video?.height || dimensions.height;
    }

    if (!videoUrl) {
      throw new Error('No video URL in response');
    }

    // Deduct credits on successful generation (using database function for atomic operation)
    const { data: creditTransaction, error: creditTransactionError } = await serviceClient
      .rpc('deduct_credits', {
        p_user_id: userId,
        p_amount: 1,
        p_description: `Video generation: ${prompt.substring(0, 50)}...`
      });
    
    let creditTransactionId = null;
    if (creditTransactionError) {
      console.error('Failed to deduct credits:', creditTransactionError);
      // Continue even if credit deduction fails - video was generated successfully
    } else if (creditTransaction && creditTransaction.length > 0) {
      creditTransactionId = creditTransaction[0].transaction_id;
    }

    // Update generation record with result and link credit transaction
    const { error: updateError } = await serviceClient
      .from('video_generations')
      .update({
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
        duration_seconds: duration,
        credit_transaction_id: creditTransactionId,
        metadata: {
          ...metadata,
          width,
          height,
          fal_request_id: result.requestId,
          generation_time_ms: Date.now() - new Date(result.logs?.[0]?.timestamp || Date.now()).getTime()
        },
        status: 'completed'
      })
      .eq('id', generationId);

    if (updateError) {
      console.error('Failed to update generation:', updateError);
      throw updateError;
    }

    // Deduct 1 credit for successful video generation
    const { data: deductResult, error: deductError } = await serviceClient
      .rpc('deduct_credits', {
        p_user_id: userId,
        p_amount: 1,
        p_description: `Video generation: ${prompt.substring(0, 50)}...`,
        p_reference_type: 'video_generation',
        p_reference_id: generationId
      });

    if (deductError) {
      console.error('Failed to deduct credits:', deductError);
      // Continue - video was generated successfully even if credit deduction fails
    } else if (deductResult === true) {
      console.log(`Successfully deducted 1 credit for user ${userId}, generation ${generationId}`);
    } else {
      console.error('Credit deduction returned false - user may have insufficient credits');
    }

    // Track API usage
    await serviceClient
      .from('api_usage_tracking')
      .insert({
        user_id: userId,
        api_provider: 'fal.ai',
        endpoint: model,
        credits_used: 1,
        request_metadata: {
          prompt_length: prompt.length,
          model,
          aspect_ratio: aspectRatio,
          generation_id: generationId
        }
      });

    console.log('Video generation completed successfully');

  } catch (error: any) {
    console.error('Generation failed:', error);
    
    // Update generation record with error
    await serviceClient
      .from('video_generations')
      .update({
        status: 'failed',
        error_message: error.message || 'Generation failed'
      })
      .eq('id', generationId);

    throw error;
  }
}