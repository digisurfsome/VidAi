import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getTestModeFromRequest, getStripeClient, addTestModeMetadata } from './stripe-utils'

// Initialize Supabase Admin Client
const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  )

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Detect test mode from request header
    const isTestMode = getTestModeFromRequest(req)
    console.log('[Credit Purchase] Test mode:', isTestMode)
    
    // Get Stripe client based on test mode
    const stripe = getStripeClient(isTestMode)
    
    // Get auth token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const token = authHeader.replace('Bearer ', '')
    
    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const { packageId, priceInCents, successUrl, cancelUrl, stripePriceId, stripeProductId } = req.body

    if (!packageId || !priceInCents) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Get or create Stripe customer
    let stripeCustomerId: string | null = null

    // Check if customer exists
    const { data: existingCustomer } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: addTestModeMetadata({
          supabase_user_id: user.id
        }, isTestMode)
      })

      stripeCustomerId = customer.id

      // Save to database
      await supabase
        .from('stripe_customers')
        .insert({
          user_id: user.id,
          stripe_customer_id: customer.id,
          email: user.email,
          is_test: isTestMode
        })
    }

    // Fetch package details from database
    const { data: dbPackage, error: packageError } = await supabase
      .from('credit_packages')
      .select('*')
      .eq('id', packageId)
      .eq('is_test', isTestMode)
      .eq('is_active', true)
      .is('archived_at', null)
      .single()
    
    if (packageError || !dbPackage) {
      console.error('Package not found:', packageError)
      return res.status(400).json({ error: 'Invalid package selected' })
    }
    
    const packageDetails = {
      name: `${dbPackage.name} - ${dbPackage.total_credits || dbPackage.credits} Credits`,
      credits: dbPackage.total_credits || dbPackage.credits,
      stripe_price_id: stripePriceId || dbPackage.stripe_price_id,
      stripe_product_id: stripeProductId || dbPackage.stripe_product_id
    }

    // Create Stripe Checkout session
    let lineItems: any[] = []
    
    // If we have a Stripe price ID from the database, use it
    if (packageDetails.stripe_price_id) {
      lineItems = [{
        price: packageDetails.stripe_price_id,
        quantity: 1,
      }]
    } else {
      // Fallback to creating price data on the fly
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: packageDetails.name,
            description: `Add ${packageDetails.credits} credits to your account`,
            metadata: addTestModeMetadata({
              type: 'credit_package',
              package_id: packageId,
              credits: packageDetails.credits.toString()
            }, isTestMode)
          },
          unit_amount: priceInCents,
        },
        quantity: 1,
      }]
    }
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer: stripeCustomerId,
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl || `${process.env.VITE_APP_URL}/dashboard?credit_purchase=success`,
      cancel_url: cancelUrl || `${process.env.VITE_APP_URL}/dashboard?credit_purchase=cancelled`,
      metadata: addTestModeMetadata({
        user_id: user.id,
        package_id: packageId,
        credits: packageDetails.credits.toString(),
        type: 'credit_purchase'
      }, isTestMode),
      payment_intent_data: {
        metadata: addTestModeMetadata({
          user_id: user.id,
          package_id: packageId,
          credits: packageDetails.credits.toString(),
          type: 'credit_purchase'
        }, isTestMode)
      }
    })

    return res.status(200).json({ 
      sessionId: session.id,
      url: session.url 
    })
  } catch (error: any) {
    console.error('[Credit Purchase] Error:', error)
    
    // Check for Stripe configuration errors
    if (error.message?.includes('secret key not configured')) {
      return res.status(500).json({ 
        error: 'Stripe configuration error',
        details: 'The payment system is not properly configured. Please contact support.',
        testMode: getTestModeFromRequest(req)
      })
    }
    
    // Check for Stripe API errors
    if (error.type === 'StripeAuthenticationError') {
      return res.status(500).json({ 
        error: 'Payment authentication error',
        details: 'Unable to authenticate with payment provider. Please try again later.',
        testMode: getTestModeFromRequest(req)
      })
    }
    
    // Generic error response
    return res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred processing your request',
      testMode: getTestModeFromRequest(req)
    })
  }
}