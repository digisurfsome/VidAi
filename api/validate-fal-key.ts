import type { VercelRequest, VercelResponse } from '@vercel/node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  dotenv.config({ path: join(__dirname, '..', '.env.local') });
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { api_key, falKey } = req.body;
    const keyToValidate = api_key || falKey;

    if (!keyToValidate) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Basic format validation
    const isValidFormat = keyToValidate.includes(':') || keyToValidate.startsWith('key_');
    
    if (!isValidFormat) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid API key format. Must be in format "key_id:key_secret" or start with "key_"',
      });
    }

    // For test requests, perform basic validation only
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
