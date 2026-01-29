import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('[Test Webhook] Method:', req.method);
  console.log('[Test Webhook] Headers:', req.headers);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Just acknowledge the webhook for testing
  console.log('[Test Webhook] Webhook received successfully');
  return res.status(200).json({ received: true });
}