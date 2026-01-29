import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Get test mode from request headers
function getTestModeFromRequest(req: VercelRequest): boolean {
  const testModeHeader = req.headers['x-test-mode']
  return testModeHeader === 'true'
}

// Create Stripe client based on mode
function getStripeClient(isTestMode: boolean): Stripe {
  const stripeSecretKey = isTestMode 
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY
  
  if (!stripeSecretKey) {
    throw new Error(`${isTestMode ? 'Test' : 'Live'} Stripe secret key not configured`)
  }
  
  return new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
    typescript: true,
  })
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get test mode from header or query param
    const isTestMode = getTestModeFromRequest(req) || req.query.test_mode === 'true'
    
    // Initialize Supabase client with anon key for RLS
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase configuration missing')
    }
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    
    // Fetch active credit packages from database
    // Filter by test mode and only return active packages
    const { data: packages, error } = await supabase
      .from('credit_packages')
      .select(`
        id,
        name,
        credits,
        price_cents,
        bonus_percentage,
        stripe_product_id,
        stripe_price_id,
        display_order,
        sort_order,
        popular_badge,
        is_test,
        currency
      `)
      .eq('is_active', true)
      .eq('is_test', isTestMode)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
    
    if (error) {
      console.error('Error fetching credit packages:', error)
      return res.status(500).json({ 
        error: 'Failed to fetch credit packages',
        details: error.message 
      })
    }
    
    // If we have Stripe IDs, verify they exist in Stripe
    // This ensures we don't show packages with invalid Stripe data
    if (packages && packages.length > 0) {
      try {
        const stripe = getStripeClient(isTestMode)
        
        // Verify each package's Stripe price exists
        const verifiedPackages = await Promise.all(
          packages.map(async (pkg) => {
            if (pkg.stripe_price_id) {
              try {
                const price = await stripe.prices.retrieve(pkg.stripe_price_id)
                // Only return package if price is active
                if (!price.active) {
                  console.warn(`Price ${pkg.stripe_price_id} is not active in Stripe`)
                  return null
                }
              } catch (err) {
                console.warn(`Failed to verify price ${pkg.stripe_price_id}:`, err)
                return null
              }
            }
            return pkg
          })
        )
        
        // Filter out packages with invalid Stripe prices
        const validPackages = verifiedPackages.filter(pkg => pkg !== null)
        
        // Transform packages for frontend consumption
        const transformedPackages = validPackages.map(pkg => {
          // Calculate total credits including bonus
          const totalCredits = pkg.credits + Math.floor((pkg.credits * (pkg.bonus_percentage || 0)) / 100);
          
          return {
            id: pkg.id,
            name: pkg.name,
            credits: totalCredits,
            base_credits: pkg.credits,
            price_cents: pkg.price_cents,
            price: pkg.price_cents, // Legacy field support
            bonus_percentage: pkg.bonus_percentage || 0,
            description: pkg.description,
            stripe_product_id: pkg.stripe_product_id,
            stripe_price_id: pkg.stripe_price_id,
            popular: pkg.popular_badge || false,
            display_order: pkg.display_order || pkg.sort_order || 0,
            currency: pkg.currency || 'USD',
            is_test: pkg.is_test
          };
        })
        
        return res.status(200).json({
          packages: transformedPackages,
          test_mode: isTestMode,
          count: transformedPackages.length
        })
      } catch (stripeError) {
        // If Stripe verification fails, still return packages but log the error
        console.error('Stripe verification failed:', stripeError)
        
        // Transform packages without Stripe verification
        const transformedPackages = packages.map(pkg => {
          // Calculate total credits including bonus
          const totalCredits = pkg.credits + Math.floor((pkg.credits * (pkg.bonus_percentage || 0)) / 100);
          
          return {
            id: pkg.id,
            name: pkg.name,
            credits: totalCredits,
            base_credits: pkg.credits,
            price_cents: pkg.price_cents,
            price: pkg.price_cents,
            bonus_percentage: pkg.bonus_percentage || 0,
            description: pkg.description,
            stripe_product_id: pkg.stripe_product_id,
            stripe_price_id: pkg.stripe_price_id,
            popular: pkg.popular_badge || false,
            display_order: pkg.display_order || pkg.sort_order || 0,
            currency: pkg.currency || 'USD',
            is_test: pkg.is_test
          };
        })
        
        return res.status(200).json({
          packages: transformedPackages,
          test_mode: isTestMode,
          count: transformedPackages.length,
          warning: 'Stripe verification skipped'
        })
      }
    }
    
    // Return empty array if no packages found
    return res.status(200).json({
      packages: [],
      test_mode: isTestMode,
      count: 0
    })
    
  } catch (error: any) {
    console.error('Error in credit-packages API:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    })
  }
}