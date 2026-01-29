-- Migration: Fix RLS Recursion and Admin View Permissions
-- Description: Replaces recursive RLS policies with a SECURITY DEFINER function
--              to safely check for admin privileges. This resolves an infinite
--              recursion error on the user_roles table and ensures admins can
--              view subscriptions and roles correctly.
-- Created: 2025-08-29

BEGIN;

-- Drop the faulty policies that were causing recursion or failing silently.
-- It's safe to run these even if the policies don't exist.
DROP POLICY IF EXISTS "Admins can view all user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all user subscriptions" ON public.user_subscriptions;

-- Create a reusable, secure function to check if the current user is an admin.
-- SECURITY DEFINER allows this function to bypass RLS on the user_roles table
-- for the duration of its execution, thus avoiding recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
-- Set a secure search_path to prevent potential hijacking.
SET search_path = public
AS $$
BEGIN
  -- Check if the current user has an active admin role.
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND status = 'active'
  );
END;
$$;

-- Grant permission for any authenticated user to call this function.
-- The function itself contains the logic to see if they are an admin.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Re-create the policy for user_roles using the safe is_admin() function.
-- This policy, combined with the existing "Users can view their own role" policy (using OR),
-- allows admins to see all roles while users can still see their own.
CREATE POLICY "Admins can view all user roles" ON public.user_roles
  FOR SELECT
  USING (is_admin());

-- Re-create the policy for user_subscriptions using the safe is_admin() function.
-- This policy, combined with the existing "Users can view own subscriptions" policy (using OR),
-- allows admins to see all subscriptions while users can still see their own.
CREATE POLICY "Admins can view all user subscriptions" ON public.user_subscriptions
  FOR SELECT
  USING (is_admin());

COMMIT;
