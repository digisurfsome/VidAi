-- Rollback Migration: Revert DELETE Permissions Fix for Video Generations
-- Description: Reverts the changes made in 00009_fix_delete_generation_permissions.sql
-- Created: 2025-08-31
-- Purpose: Emergency rollback if the DELETE permission fix causes issues

BEGIN;

-- Step 1: Drop the admin DELETE policy
DROP POLICY IF EXISTS "Admins can delete all video generations" ON public.video_generations;

-- Step 2: Drop the user DELETE policy with JWT handling
DROP POLICY IF EXISTS "Users can delete own video generations" ON public.video_generations;

-- Step 3: Recreate the original simple DELETE policy (if it existed)
-- Note: The original migration included this policy but it wasn't in the database
-- We'll recreate it for consistency with the original intent
CREATE POLICY "Users can delete own video generations"
  ON public.video_generations FOR DELETE
  USING (auth.uid() = user_id);

-- Step 4: Revoke DELETE permission from authenticated role
-- This returns to the state where DELETE was not explicitly granted
REVOKE DELETE ON public.video_generations FROM authenticated;

-- Add rollback documentation
COMMENT ON POLICY "Users can delete own video generations" ON public.video_generations 
  IS 'Original simple DELETE policy - only checks auth.uid()';

-- Verify the rollback
DO $$
DECLARE
  delete_policy_count INTEGER;
  delete_permission_exists BOOLEAN;
BEGIN
  -- Check DELETE policies
  SELECT COUNT(*) INTO delete_policy_count
  FROM pg_policies 
  WHERE tablename = 'video_generations' 
    AND cmd = 'DELETE'
    AND policyname != 'Service role has full access to video_generations';
  
  -- Check DELETE permission was revoked
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public' 
      AND table_name = 'video_generations'
      AND grantee = 'authenticated'
      AND privilege_type = 'DELETE'
  ) INTO delete_permission_exists;
  
  -- Report results
  RAISE NOTICE 'DELETE policies after rollback: %', delete_policy_count;
  RAISE NOTICE 'DELETE permission for authenticated after rollback: %', delete_permission_exists;
  
  -- Verify rollback completed
  IF delete_policy_count > 1 THEN
    RAISE WARNING 'More than 1 DELETE policy exists after rollback: %', delete_policy_count;
  END IF;
  
  IF delete_permission_exists THEN
    RAISE WARNING 'DELETE permission still exists for authenticated role after rollback';
  END IF;
END $$;

COMMIT;

-- Note: After running this rollback, users will experience the original
-- "permission denied for table video_generations" error when attempting deletions.
-- This rollback should only be used if the fix causes unexpected issues.