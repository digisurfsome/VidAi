-- =====================================================
-- Migration: Fix Credit Packages Permissions
-- Date: 2025-08-31
-- Description: Grant service role permissions on credit_packages table
--              to fix 403 errors when managing packages through admin API
-- =====================================================

-- Start transaction for atomic operation
BEGIN;

-- =====================================================
-- 1. Grant Service Role Permissions
-- =====================================================

-- Grant all privileges on credit_packages table to service role
-- This allows the service role to perform CRUD operations via API
GRANT ALL PRIVILEGES ON TABLE public.credit_packages TO service_role;

-- Grant usage on any sequences (for auto-generated IDs)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =====================================================
-- 2. Add RLS Policies for Admin Access
-- =====================================================

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Public can view active packages" ON credit_packages;
DROP POLICY IF EXISTS "Admin users can manage credit packages" ON credit_packages;
DROP POLICY IF EXISTS "Service role can manage credit packages" ON credit_packages;

-- Policy 1: Public users can view active packages
CREATE POLICY "Public can view active packages"
ON credit_packages
FOR SELECT
TO public
USING (is_active = true);

-- Policy 2: Authenticated admin users can manage packages
CREATE POLICY "Admin users can manage credit packages"
ON credit_packages
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

-- Policy 3: Service role bypass for API operations
-- This ensures the service role can always access the table
CREATE POLICY "Service role can manage credit packages"
ON credit_packages
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================
-- 3. Verify and Ensure RLS is Enabled
-- =====================================================

-- Ensure RLS is enabled on the table
ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 4. Grant Additional Permissions for Related Operations
-- =====================================================

-- Grant permissions on related tables that might be accessed
-- during credit package operations

-- Ensure service role can access stripe_sync_log for sync operations
GRANT ALL PRIVILEGES ON TABLE public.stripe_sync_log TO service_role;

-- Ensure service role can access price_history if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name = 'price_history') THEN
    EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.price_history TO service_role';
  END IF;
END $$;

-- =====================================================
-- 5. Create Helper Function for Admin Check (if not exists)
-- =====================================================

-- Create is_admin function if it doesn't exist
-- This function is used in RLS policies
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- =====================================================
-- Verification Query (commented out, for manual testing)
-- =====================================================

-- To verify permissions after migration:
-- SELECT 
--   grantee, 
--   privilege_type 
-- FROM information_schema.table_privileges 
-- WHERE table_name = 'credit_packages' 
--   AND grantee IN ('service_role', 'authenticated', 'anon');

-- To verify RLS policies:
-- SELECT 
--   schemaname, 
--   tablename, 
--   policyname, 
--   permissive, 
--   roles, 
--   cmd, 
--   qual 
-- FROM pg_policies 
-- WHERE tablename = 'credit_packages';

-- Commit transaction
COMMIT;

-- =====================================================
-- Rollback Commands (for reference, not executed)
-- =====================================================

-- To rollback this migration, run:
-- BEGIN;
-- REVOKE ALL PRIVILEGES ON TABLE public.credit_packages FROM service_role;
-- REVOKE ALL PRIVILEGES ON TABLE public.stripe_sync_log FROM service_role;
-- DROP POLICY IF EXISTS "Public can view active packages" ON credit_packages;
-- DROP POLICY IF EXISTS "Admin users can manage credit packages" ON credit_packages;
-- DROP POLICY IF EXISTS "Service role can manage credit packages" ON credit_packages;
-- CREATE POLICY "Public can view active credit packages" ON credit_packages
--   FOR SELECT USING (is_active = true);
-- COMMIT;