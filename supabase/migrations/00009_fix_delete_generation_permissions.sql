-- Migration: Fix DELETE Permissions for Video Generations
-- Description: Adds missing DELETE RLS policy and permissions to fix "permission denied" errors
--              when users attempt to delete their video generations
-- Created: 2025-08-31
-- Issue: DELETE operations fail with permission denied due to missing policy and permissions

BEGIN;

-- Step 1: Grant DELETE permission to authenticated role
-- This was missing from the original migration and recent fixes
GRANT DELETE ON public.video_generations TO authenticated;

-- Step 2: Drop existing DELETE policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can delete own video generations" ON public.video_generations;
DROP POLICY IF EXISTS "Admins can delete all video generations" ON public.video_generations;

-- Step 3: Create DELETE RLS policy for users
-- Matches the pattern used in the fixed SELECT policy to handle both auth methods
CREATE POLICY "Users can delete own video generations"
  ON public.video_generations 
  FOR DELETE
  USING (
    auth.uid() = user_id 
    OR 
    (auth.role() = 'authenticated' AND user_id::text = (auth.jwt() ->> 'sub'))
  );

-- Step 4: Create admin DELETE policy for content moderation
-- Allows admins to delete any video generation for moderation purposes
CREATE POLICY "Admins can delete all video generations"
  ON public.video_generations 
  FOR DELETE
  USING (public.is_admin());

-- Step 5: Ensure service role maintains full access (should already exist but be explicit)
-- Service role policy already exists from migration 00001, but we'll ensure it covers DELETE
DO $$
BEGIN
  -- Check if the service role policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'video_generations' 
    AND policyname = 'Service role has full access to video_generations'
  ) THEN
    CREATE POLICY "Service role has full access to video_generations"
      ON public.video_generations FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Add documentation comments
COMMENT ON POLICY "Users can delete own video generations" ON public.video_generations 
  IS 'Allows users to delete their own video generations, handles both auth.uid() and JWT sub claim authentication';

COMMENT ON POLICY "Admins can delete all video generations" ON public.video_generations 
  IS 'Allows admin users to delete any video generation for content moderation purposes';

-- Verify the changes
DO $$
DECLARE
  delete_policy_count INTEGER;
  delete_permission_exists BOOLEAN;
BEGIN
  -- Check DELETE policies exist
  SELECT COUNT(*) INTO delete_policy_count
  FROM pg_policies 
  WHERE tablename = 'video_generations' AND cmd = 'DELETE';
  
  -- Check DELETE permission granted
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public' 
      AND table_name = 'video_generations'
      AND grantee = 'authenticated'
      AND privilege_type = 'DELETE'
  ) INTO delete_permission_exists;
  
  -- Raise notice about the results
  RAISE NOTICE 'DELETE policies created: %', delete_policy_count;
  RAISE NOTICE 'DELETE permission granted to authenticated: %', delete_permission_exists;
  
  -- Ensure we have at least 2 DELETE policies (user and admin)
  IF delete_policy_count < 2 THEN
    RAISE WARNING 'Expected at least 2 DELETE policies, found %', delete_policy_count;
  END IF;
  
  -- Ensure DELETE permission was granted
  IF NOT delete_permission_exists THEN
    RAISE EXCEPTION 'DELETE permission not granted to authenticated role';
  END IF;
END $$;

COMMIT;