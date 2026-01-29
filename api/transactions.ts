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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

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
      // Parse query parameters
      const { filter, limit = 20, offset = 0 } = req.query;
      
      console.log('Transaction query params:', { filter, limit, offset, userId: user.id });

      // Build base query
      let query = supabase
        .from('credit_transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      // Apply test mode filter (consistent with credits API)
      query = query.eq('is_test', isTestMode);

      // Apply amount filter
      if (filter === 'credits') {
        query = query.gt('amount', 0);
      } else if (filter === 'debits') {
        query = query.lt('amount', 0);
      }

      const { data: transactions, error, count } = await query;

      if (error) {
        console.error('Transaction query error:', error);
        return res.status(500).json({ error: error.message });
      }

      console.log(`Found ${transactions.length} transactions for user ${user.id}`);

      return res.json({
        transactions: transactions || [],
        total: count || 0,
        hasMore: count ? Number(offset) + Number(limit) < count : false
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: unknown) {
    console.error('Transaction API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}