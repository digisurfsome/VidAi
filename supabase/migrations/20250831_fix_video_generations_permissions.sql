-- Migration: Fix Video Generations Table Permissions
-- Description: Grants service role permissions and fixes RLS policies to resolve 403 errors
--              when accessing video_generations table
-- Created: 2025-08-31
-- Issue: Frontend queries using anon key get 403 errors due to restrictive RLS policies

BEGIN;

-- Step 2.1.2: Grant service role full privileges on video_generations table
GRANT ALL PRIVILEGES ON TABLE public.video_generations TO service_role;

-- Step 2.1.4: Drop existing restrictive policy
DROP POLICY IF EXISTS "Users can view own video generations" ON public.video_generations;

-- Step 2.1.5: Create improved policy that handles both auth.uid() and JWT sub claim
-- This ensures the policy works with both direct auth and JWT token authentication
CREATE POLICY "Users can view own video generations" 
  ON public.video_generations 
  FOR SELECT
  USING (
    auth.uid() = user_id 
    OR 
    (auth.role() = 'authenticated' AND user_id::text = (auth.jwt() ->> 'sub'))
  );

-- Step 2.1.6: Add admin view policy using existing is_admin() function
-- This allows admins to see all video generations for support and management
CREATE POLICY "Admins can view all video generations"
  ON public.video_generations 
  FOR SELECT
  USING (public.is_admin());

-- Grant explicit permissions for authenticated role to ensure proper access
GRANT SELECT ON public.video_generations TO authenticated;
GRANT INSERT ON public.video_generations TO authenticated;
GRANT UPDATE ON public.video_generations TO authenticated;

-- Add comments for documentation
COMMENT ON POLICY "Users can view own video generations" ON public.video_generations 
  IS 'Allows users to view their own video generations, handles both auth.uid() and JWT sub claim';

COMMENT ON POLICY "Admins can view all video generations" ON public.video_generations 
  IS 'Allows admin users to view all video generations for support purposes';

COMMIT;