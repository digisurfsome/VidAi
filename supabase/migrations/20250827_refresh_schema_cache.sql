-- Refresh PostgREST schema cache to detect subscription_plans table
NOTIFY pgrst, 'reload schema';

-- Enable RLS on subscription_plans table
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Public can view active plans" ON subscription_plans;
DROP POLICY IF EXISTS "Service role has full access" ON subscription_plans;
DROP POLICY IF EXISTS "Authenticated users can view all plans" ON subscription_plans;

-- Create RLS policies following app patterns
-- Allow public/anon to view active plans (for pricing page)
CREATE POLICY "Public can view active plans" ON subscription_plans
  FOR SELECT 
  USING (is_active = true);

-- Allow authenticated users to view all plans (for admin UI)
CREATE POLICY "Authenticated users can view all plans" ON subscription_plans
  FOR SELECT 
  TO authenticated
  USING (true);

-- Service role has full access for admin operations
CREATE POLICY "Service role has full access" ON subscription_plans
  FOR ALL 
  TO service_role
  USING (true);

-- Create a utility function to refresh schema cache when needed
CREATE OR REPLACE FUNCTION refresh_schema_cache()
RETURNS void
LANGUAGE sql
AS $$
  NOTIFY pgrst, 'reload schema';
$$;

-- Grant execute to authenticated users (admins)
GRANT EXECUTE ON FUNCTION refresh_schema_cache() TO authenticated;

-- Also refresh other table caches to ensure consistency
NOTIFY pgrst, 'reload config';