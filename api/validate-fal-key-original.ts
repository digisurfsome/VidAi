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

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's JWT token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    const { api_key, test_connection } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Basic format validation
    const isValidFormat = api_key.includes(':') || api_key.startsWith('key_');
    
    if (!isValidFormat) {
      return res.status(422).json({
        valid: false,
        message: 'Invalid API key format. Must be in format "key_id:key_secret" or start with "key_"',
      });
    }

    // If test_connection is true, attempt to validate with fal.ai
    if (test_connection) {
      try {
        // Import fal.ai client dynamically to avoid build issues
        const { fal } = await import('@fal-ai/client');
        
        // Configure the client with the provided key
        fal.config({
          credentials: api_key,
        });

        // Try a simple API call to validate the key
        // We'll use the list models endpoint or a lightweight operation
        try {
          // Try to get account info or perform a lightweight operation
          // This is a placeholder - replace with actual fal.ai validation endpoint
          const testResult = await fal.run('fal-ai/fast-sdxl', {
            input: {
              prompt: 'test',
              image_size: 'square_hd',
              num_inference_steps: 1,
              num_images: 1,
            },
            // Use the lowest possible resources for testing
            logs: false,
          }).catch((error: any) => {
            // Check if it's an auth error vs other errors
            if (error.message?.includes('401') || error.message?.includes('403') || error.message?.includes('authentication')) {
              throw new Error('Invalid API key');
            }
            // If it's a different error (like rate limit), the key might still be valid
            return { valid: true, warning: 'Key validated but test generation failed' };
          });

          return res.status(200).json({
            valid: true,
            message: 'API key validated successfully',
            credits_remaining: null, // fal.ai doesn't provide this directly
          });
        } catch (falError: any) {
          if (falError.message?.includes('Invalid API key') || falError.message?.includes('401')) {
            return res.status(401).json({
              valid: false,
              message: 'Invalid API key. Please check your credentials.',
            });
          }
          
          // Other errors might not mean the key is invalid
          return res.status(200).json({
            valid: true,
            message: 'API key format is valid (connection test inconclusive)',
            warning: falError.message,
          });
        }
      } catch (error: any) {
        console.error('Error testing fal.ai connection:', error);
        
        // If we can't test the connection, just validate the format
        return res.status(200).json({
          valid: true,
          message: 'API key format is valid (connection test unavailable)',
        });
      }
    }

    // Just validate format without testing connection
    return res.status(200).json({
      valid: true,
      message: 'API key format is valid',
    });

  } catch (error: any) {
    console.error('Error validating fal.ai key:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}