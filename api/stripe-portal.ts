import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// Helper to get test mode from request header
function getTestModeFromRequest(req: VercelRequest): boolean {
  const testModeHeader = req.headers['x-test-mode']
  return testModeHeader === 'true'
}

// Helper to get Stripe instance based on test mode
function getStripeClient(isTestMode: boolean): Stripe {
  const stripeSecretKey = isTestMode 
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY
  
  return new Stripe(stripeSecretKey!, {
    apiVersion: '2023-10-16',
  })
}

// Initialize Supabase with service role
const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { userId, returnUrl } = req.body

    // Validate required fields
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    // Get the appropriate Stripe client based on test mode
    const isTestMode = getTestModeFromRequest(req)
    const stripe = getStripeClient(isTestMode)

    // Get user's Stripe customer ID from database
    const { data: customer, error: customerError } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    if (customerError || !customer?.stripe_customer_id) {
      return res.status(400).json({ 
        error: 'No subscription found. Please subscribe to a plan first.' 
      })
    }

    // Check if portal configuration exists, create if not
    const configurations = await stripe.billingPortal.configurations.list({
      limit: 1
    })

    let configurationId: string | undefined

    if (configurations.data.length === 0) {
      // Create a default configuration
      const config = await stripe.billingPortal.configurations.create({
        business_profile: {
          headline: 'Manage your subscription'
        },
        features: {
          invoice_history: { 
            enabled: true 
          },
          payment_method_update: { 
            enabled: true 
          },
          subscription_cancel: { 
            enabled: true,
            mode: 'at_period_end',
            cancellation_reason: {
              enabled: true,
              options: [
                'too_expensive',
                'missing_features',
                'switched_service',
                'unused',
                'other'
              ]
            }
          },
          subscription_update: {
            enabled: true,
            default_allowed_updates: ['price', 'quantity'],
            proration_behavior: 'create_prorations',
            products: [
              {
                product: '*',
                prices: ['*']
              }
            ]
          }
        },
        default_return_url: returnUrl || `${req.headers.origin}/dashboard/settings`
      })

      configurationId = config.id
    } else {
      configurationId = configurations.data[0].id
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: returnUrl || `${req.headers.origin}/dashboard/settings`,
      configuration: configurationId
    })

    return res.status(200).json({ 
      url: session.url 
    })
  } catch (error: any) {
    console.error('Stripe portal error:', error)
    
    return res.status(500).json({ 
      error: 'Failed to create portal session',
      details: error.message 
    })
  }
}