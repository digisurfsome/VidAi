import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase Admin Client with service role for full access
const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Test-Mode'
  )

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  try {
    // Get auth token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const token = authHeader.replace('Bearer ', '')
    
    // Initialize Supabase client with service role for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    
    // Verify user is admin
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    
    // Check admin role
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()
    
    if (roleError || !roleData || roleData.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    
    // Get test mode from header
    const isTestMode = req.headers['x-test-mode'] === 'true'
    
    if (req.method === 'GET') {
      // Fetch all packages for admin view (including inactive)
      const { data: packages, error } = await supabaseAdmin
        .from('credit_packages')
        .select('*')
        .eq('is_test', isTestMode)
        .order('sort_order', { ascending: true })
      
      if (error) {
        console.error('Error fetching packages:', error)
        return res.status(500).json({ 
          error: 'Failed to fetch packages',
          details: error.message 
        })
      }
      
      // Transform packages for frontend compatibility
      const packagesWithTotals = (packages || []).map(pkg => ({
        ...pkg,
        // Map sort_order to display_order for frontend
        display_order: pkg.sort_order || 0,
        // Calculate total_credits including bonus
        total_credits: pkg.credits + Math.floor((pkg.credits * (pkg.bonus_percentage || 0)) / 100),
        // Convert price_cents to dollars
        price: pkg.price_cents / 100,
        // Ensure bonus_percentage exists
        bonus_percentage: pkg.bonus_percentage || 0
      }))
      
      return res.status(200).json(packagesWithTotals)
    }
    
    return res.status(405).json({ error: 'Method not allowed' })
    
  } catch (error: any) {
    console.error('Error in admin-credit-packages API:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    })
  }
}