import { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { priceId } = req.body;

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    // Determine if we're in test mode
    const isTestMode = process.env.VITE_STRIPE_TEST_MODE === 'true';
    const stripeSecretKey = isTestMode 
      ? process.env.STRIPE_TEST_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      console.error('Stripe secret key not configured');
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    // Create checkout session for new user
    // We'll collect email in Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      // After successful payment, redirect to our success handler
      success_url: `${process.env.VITE_APP_URL}/api/stripe-success-handler?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_APP_URL}/pricing`,
      // Allow Stripe to collect email
      customer_email: undefined,
      // Store metadata for later processing
      metadata: {
        new_user_signup: 'true',
        test_mode: isTestMode ? 'true' : 'false',
      },
      subscription_data: {
        metadata: {
          new_user_signup: 'true',
          test_mode: isTestMode ? 'true' : 'false',
        }
      }
    });

    console.log('Created checkout session for new user:', session.id);

    return res.status(200).json({ 
      sessionId: session.id,
      url: session.url 
    });
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to create checkout session' 
    });
  }
}