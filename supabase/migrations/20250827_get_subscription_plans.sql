-- Migration: Create RPC function get_subscription_plans
-- Description: Provides a stable, zero-arg RPC to fetch non-archived subscription plans
-- Created: 2025-08-26

BEGIN;

-- Drop existing function to allow return type change
DROP FUNCTION IF EXISTS public.get_subscription_plans();

-- Create or replace RPC for fetching plans (no params)
CREATE OR REPLACE FUNCTION public.get_subscription_plans()
RETURNS SETOF public.subscription_plans
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT sp.*
  FROM public.subscription_plans sp
  WHERE sp.archived_at IS NULL
  ORDER BY sp.sort_order ASC, sp.created_at DESC;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_subscription_plans() TO anon, authenticated, service_role;

-- Ensure PostgREST detects the new RPC immediately
NOTIFY pgrst, 'reload schema';

COMMIT;
