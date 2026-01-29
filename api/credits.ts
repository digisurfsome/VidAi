import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Determine test mode from environment (server-side)
const isTestMode = process.env.VITE_STRIPE_TEST_MODE === 'true';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log('Environment check:', {
  hasUrl: !!supabaseUrl,
  hasAnonKey: !!supabaseAnonKey, 
  hasServiceKey: !!supabaseServiceKey,
  serviceKeyPrefix: supabaseServiceKey?.substring(0, 20),
  isTestMode
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Get auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  
  // Create a user client to verify the token
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);
  
  // Verify user with their token
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Create service client for database operations (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === 'GET') {
      // Get user's credit balance with aggregation from multiple sources
      console.log('Credits API query params:', { userId: user.id, isTestMode });
      const { data: credits, error: creditsError } = await supabase
        .from('user_credits')
        .select('balance, lifetime_earned, lifetime_spent, last_refill_at, expires_at, is_test')
        .eq('user_id', user.id)
        .eq('is_test', isTestMode)
        .maybeSingle();
      
      console.log('Credits query result:', { credits, creditsError });


      // Get recent transactions for context
      const { data: recentTransactions } = await supabase
        .from('credit_transactions')
        .select('type, amount, description, created_at')
        .eq('user_id', user.id)
        .eq('is_test', isTestMode)
        .order('created_at', { ascending: false })
        .limit(5);

      // Get subscription info for refill calculations
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select(`
          status,
          current_period_start,
          current_period_end,
          subscription_plans!inner(credits_per_period, name)
        `)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .eq('is_test', isTestMode)
        .maybeSingle();

      // Calculate if refill is due
      let refillDue = false;
      let nextRefillDate = null;
      if (subscription && credits) {
        const periodStart = new Date(subscription.current_period_start);
        const lastRefill = credits.last_refill_at ? new Date(credits.last_refill_at) : null;
        refillDue = !lastRefill || periodStart > lastRefill;
        nextRefillDate = subscription.current_period_end;
      }

      // Aggregate response with comprehensive data
      const response = {
        balance: credits?.balance || 0,
        lifetime_earned: credits?.lifetime_earned || 0,
        lifetime_spent: credits?.lifetime_spent || 0,
        last_refill_at: credits?.last_refill_at,
        expires_at: credits?.expires_at,
        is_test: isTestMode,
        
        // Aggregation metadata
        sources: {
          subscription: subscription ? {
            active: true,
            credits_per_period: subscription.subscription_plans.credits_per_period,
            plan_name: subscription.subscription_plans.name,
            next_refill_date: nextRefillDate,
            refill_due: refillDue
          } : null,
          recent_transactions: recentTransactions || []
        },
        
        // Usage stats
        usage_stats: {
          efficiency_percent: credits?.lifetime_earned > 0 
            ? Math.round((credits.lifetime_spent / credits.lifetime_earned) * 100) 
            : 0,
          remaining_percent: credits?.lifetime_earned > 0 
            ? Math.round((credits.balance / credits.lifetime_earned) * 100) 
            : 0
        }
      };

      return res.json(response);
    }

    if (req.method === 'POST') {
      const { action, amount, description } = req.body;

      if (action === 'deduct') {
        const result = await supabase.rpc('deduct_credits', {
          p_user_id: user.id,
          p_amount: amount,
          p_description: description || 'Credit deduction',
          p_reference_type: 'manual',
          p_reference_id: null
        });

        return res.json({ success: result.data, remaining: result.data });
      }

      if (action === 'add') {
        const result = await supabase.rpc('add_credits', {
          p_user_id: user.id,
          p_amount: amount,
          p_type: 'bonus',
          p_description: description || 'Credit addition'
        });

        return res.json({ success: true, new_balance: result.data });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Credits API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
