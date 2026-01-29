// JavaScript version of fal-client for testing
import { fal } from '@fal-ai/client';
import { supabase } from './supabase';

/**
 * Custom error class for fal.ai client errors
 */
export class FalClientError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FalClientError';
    this.code = code;
  }
}

/**
 * Singleton instance of the fal client
 */
let falClientInstance = null;
let isInitialized = false;
let currentApiKey = null;

/**
 * Initialize the fal.ai client with an API key
 */
export function initializeFalClient(apiKey) {
  // Validate API key format
  if (!apiKey || (!apiKey.includes(':') && !apiKey.startsWith('key_'))) {
    throw new FalClientError(
      'Invalid API key format. Must be in format "key_id:key_secret" or start with "key_"',
      'INVALID_KEY_FORMAT'
    );
  }

  // Configure the fal client with credentials
  fal.config({
    credentials: apiKey,
  });

  // Store the instance and mark as initialized
  falClientInstance = fal;
  isInitialized = true;
  currentApiKey = apiKey;

  return fal;
}

/**
 * Initialize the fal.ai client using a user's stored API key
 */
export async function initializeFalClientForUser(userId) {
  if (!userId) {
    throw new FalClientError('User ID is required', 'MISSING_USER_ID');
  }

  // Fetch the user's API key from the database
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('key_value')
    .eq('user_id', userId)
    .eq('key_name', 'fal_ai')
    .single();

  if (error || !data?.key_value) {
    throw new FalClientError(
      'No fal.ai API key found for user. Please configure it in Settings.',
      'NO_API_KEY'
    );
  }

  return initializeFalClient(data.key_value);
}

/**
 * Get the current fal client instance
 */
export function getFalClient() {
  if (!isInitialized || !falClientInstance) {
    throw new FalClientError(
      'fal.ai client not initialized. Call initializeFalClient first.',
      'NOT_INITIALIZED'
    );
  }

  return falClientInstance;
}

/**
 * Check if the fal client is initialized
 */
export function isFalClientInitialized() {
  return isInitialized;
}

/**
 * Reset the fal client (useful for switching API keys)
 */
export function resetFalClient() {
  falClientInstance = null;
  isInitialized = false;
  currentApiKey = null;
}

/**
 * Get a mock fal client for development/testing
 */
export function getMockFalClient() {
  return {
    subscribe: async (model, options) => {
      console.log('[Mock fal.ai] Subscribe called:', { model, options });
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Return mock video generation result
      const mockResult = {
        video_url: 'https://example.com/mock-video.mp4',
        thumbnail_url: 'https://example.com/mock-thumbnail.jpg',
        duration: 3.5,
        width: 1920,
        height: 1080,
        request_id: 'mock_' + Date.now(),
        generation_time_ms: 1000,
      };
      
      return mockResult;
    },
    
    run: async (model, options) => {
      console.log('[Mock fal.ai] Run called:', { model, options });
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Return mock result
      return {
        video_url: 'https://example.com/mock-video-run.mp4',
        request_id: 'mock_run_' + Date.now(),
      };
    },
    
    config: (options) => {
      console.log('[Mock fal.ai] Config called:', options);
    },
  };
}

/**
 * Wrapper function to generate video with error handling
 */
export async function generateVideo(model, prompt, options = {}) {
  try {
    const client = getFalClient();
    
    // Prepare the input
    const input = {
      prompt,
      ...options,
    };
    
    console.log('[fal.ai] Generating video:', { model, prompt: prompt.substring(0, 50) + '...' });
    
    // Use subscribe which handles queueing and polling automatically
    // The fal.ai docs show this is the recommended approach
    const result = await client.subscribe(model, {
      input,
      pollInterval: 5000, // Check every 5 seconds
      logs: true,
      onQueueUpdate: (update) => {
        console.log('[fal.ai] Queue update:', update);
        if (update.status === 'IN_PROGRESS' && update.logs) {
          update.logs.forEach(log => console.log('[fal.ai]', log.message));
        }
      }
    });
    
    console.log('[fal.ai] Generation complete, result:', JSON.stringify(result, null, 2));
    
    // The subscribe method returns {data: {...}, requestId: ...}
    // Extract the actual result data
    const resultData = result?.data || result;
    
    // Transform the result to our format - handle different response structures
    // The result structure varies by model
    const videoResult = {
      video_url: resultData?.video?.url || 
                 resultData?.video_url || 
                 resultData?.video || 
                 resultData?.url ||
                 resultData?.output?.video_url ||
                 resultData?.output?.video ||
                 result?.video?.url ||
                 result?.video_url,
      thumbnail_url: resultData?.thumbnail?.url || 
                     resultData?.thumbnail_url || 
                     resultData?.thumbnail ||
                     resultData?.output?.thumbnail_url ||
                     result?.thumbnail?.url,
      duration: resultData?.duration || resultData?.video?.duration || resultData?.output?.duration || result?.duration,
      width: resultData?.width || resultData?.video?.width || resultData?.output?.width || result?.width,
      height: resultData?.height || resultData?.video?.height || resultData?.output?.height || result?.height,
      request_id: result?.requestId || result?.request_id || resultData?.request_id,
      generation_time_ms: resultData?.generation_time_ms || resultData?.timings?.inference || result?.generation_time_ms,
    };
    
    if (!videoResult.video_url) {
      console.error('[fal.ai] No video URL found in result:', JSON.stringify(result, null, 2));
      throw new FalClientError('No video URL in response. Check console for full response.', 'NO_VIDEO_URL');
    }
    
    return videoResult;
  } catch (error) {
    // Handle specific fal.ai errors
    if (error.message?.includes('401') || error.message?.includes('authentication')) {
      throw new FalClientError('Invalid API key. Please check your credentials.', 'AUTH_ERROR');
    }
    
    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      throw new FalClientError('Rate limit exceeded. Please try again later.', 'RATE_LIMIT');
    }
    
    if (error.message?.includes('insufficient') || error.message?.includes('credits')) {
      throw new FalClientError('Insufficient credits. Please add more credits to your account.', 'INSUFFICIENT_CREDITS');
    }
    
    // Re-throw if it's already our error
    if (error instanceof FalClientError) {
      throw error;
    }
    
    // Wrap other errors
    throw new FalClientError(
      error.message || 'Failed to generate video',
      'GENERATION_ERROR'
    );
  }
}

/**
 * Get available video models
 */
export function getAvailableModels() {
  return [
    {
      id: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
      name: 'Hailuo-02 Standard',
      description: 'Fast and affordable (aspect ratio not supported)',
      maxDuration: 6,
      supportedAspectRatios: [], // Hailuo doesn't support aspect ratio selection
    },
    {
      id: 'fal-ai/veo3.1/fast',
      name: 'Veo 3.1 Fast',
      description: 'High quality video with audio from Google',
      maxDuration: 8,
      supportedAspectRatios: ['16:9', '9:16'],
    },
    {
      id: 'fal-ai/minimax-video/image-to-video',
      name: 'MiniMax Image-to-Video',
      description: 'Generate video from image and text prompt',
      maxDuration: 6,
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
    },
  ];
}

// For ES6 module compatibility
export default {
  initializeFalClient,
  initializeFalClientForUser,
  getFalClient,
  isFalClientInitialized,
  resetFalClient,
  getMockFalClient,
  generateVideo,
  getAvailableModels,
  FalClientError,
};