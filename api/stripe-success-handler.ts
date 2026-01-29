import { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Initialize Supabase client with service role key
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Generate a secure random password
function generateSecurePassword(): string {
  const length = 16;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  
  return password;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;

  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
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

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['customer', 'subscription']
    });

    // Check if this is a new user signup
    if (session.metadata?.new_user_signup !== 'true') {
      // Not a new user signup, redirect to dashboard
      return res.redirect(302, `${process.env.VITE_APP_URL}/dashboard`);
    }

    const customer = session.customer as Stripe.Customer;
    const subscription = session.subscription as Stripe.Subscription;

    if (!customer || !customer.email) {
      throw new Error('Customer email not found');
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .single();

    if (existingUser) {
      console.log('User already exists, redirecting to sign-in');
      // User already exists, redirect to sign-in
      return res.redirect(302, `${process.env.VITE_APP_URL}/sign-in?email=${encodeURIComponent(customer.email)}&message=account_exists`);
    }

    // Generate a secure password
    const password = generateSecurePassword();

    // Create the user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: customer.email,
      password: password,
      email_confirm: false, // Don't auto-confirm so Supabase sends confirmation email
      user_metadata: {
        full_name: customer.name || '',
        stripe_customer_id: customer.id,
      }
    });

    if (authError) {
      console.error('Error creating user:', authError);
      throw new Error('Failed to create user account');
    }

    const userId = authData.user.id;

    // Create stripe_customers record
    await supabase
      .from('stripe_customers')
      .insert({
        user_id: userId,
        stripe_customer_id: customer.id,
        email: customer.email,
        name: customer.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_test: isTestMode
      });

    // Get the subscription plan
    const priceId = subscription.items.data[0]?.price.id;
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('stripe_price_id', priceId)
      .single();

    // Create subscription record
    if (plan) {
      await supabase
        .from('user_subscriptions')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          stripe_subscription_id: subscription.id,
          plan_id: plan.id,
          status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_test: isTestMode
        });
    }

    // Trigger Supabase to send a password reset email so user can set their own password
    // Since we created the user with a random password, we'll send them a reset link
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(customer.email, {
      redirectTo: `${process.env.VITE_APP_URL}/auth/update-password`
    });

    if (resetError) {
      console.error('Error sending password reset email:', resetError);
    }

    // Generate a one-time login token
    const { data: tokenData, error: tokenError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: customer.email,
      options: {
        redirectTo: `${process.env.VITE_APP_URL}/dashboard?welcome=true`
      }
    });

    if (tokenError || !tokenData) {
      console.error('Error generating login token:', tokenError);
      // Fallback: redirect to sign-in page with message
      return res.redirect(302, `${process.env.VITE_APP_URL}/sign-in?email=${encodeURIComponent(customer.email)}&message=check_email`);
    }

    // Extract the token from the URL
    const tokenUrl = new URL(tokenData.properties.action_link);
    const token = tokenUrl.searchParams.get('token');

    // Redirect to auto-login page with token
    return res.redirect(302, `${process.env.VITE_APP_URL}/auth/auto-login?token=${token}&type=magiclink`);

  } catch (error: any) {
    console.error('Error processing successful payment:', error);
    // Redirect to an error page
    return res.redirect(302, `${process.env.VITE_APP_URL}/error?message=${encodeURIComponent('Failed to create account. Please contact support.')}`);
  }
}