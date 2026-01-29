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
    const { 
      priceId, 
      userId,
      userEmail,
      successUrl, 
      cancelUrl, 
      customerId,
      customerEmail,
      metadata = {}
    } = req.body

    // Validate required fields
    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' })
    }

    // Get the appropriate Stripe client based on test mode
    const isTestMode = getTestModeFromRequest(req)
    const stripe = getStripeClient(isTestMode)

    // Get or create Stripe customer
    let stripeCustomerId = customerId

    if (!stripeCustomerId && userId) {
      // Check if user already has a Stripe customer record
      const { data: existingCustomer } = await supabase
        .from('stripe_customers')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .single()

      if (existingCustomer?.stripe_customer_id) {
        stripeCustomerId = existingCustomer.stripe_customer_id
      } else if (userEmail) {
        // Create new Stripe customer
        const customer = await stripe.customers.create({
          email: userEmail,
          metadata: {
            supabase_user_id: userId
          }
        })

        // Store customer ID in database
        await supabase
          .from('stripe_customers')
          .insert({
            user_id: userId,
            stripe_customer_id: customer.id,
            email: userEmail
          })

        stripeCustomerId = customer.id
      }
    }

    // Create checkout session parameters
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: successUrl || `${req.headers.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.headers.origin}/pricing`,
      customer: stripeCustomerId,
      customer_email: !stripeCustomerId ? (customerEmail || userEmail) : undefined,
      subscription_data: {
        metadata: {
          ...metadata,
          supabase_user_id: userId || ''
        }
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    }

    // Create the session
    const session = await stripe.checkout.sessions.create(sessionParams)

    return res.status(200).json({ 
      sessionId: session.id,
      url: session.url 
    })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    
    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: error.message 
    })
  }
}